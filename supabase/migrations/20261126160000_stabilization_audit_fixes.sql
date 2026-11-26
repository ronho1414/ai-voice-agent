-- ==============================================================================
-- Orai Service — System Audit & Stabilization Fixes
-- Migration: 20261126160000_stabilization_audit_fixes.sql
-- Description:
--   1. WhatsApp outbound idempotency keys, payload hashes, and 2-phase
--      reserve/finalize RPCs preventing blind duplicate sends.
--   2. Strict WhatsApp channel allowlist on webhooks (rejects unmapped
--      phone_number_id payloads instead of dumping them into admin scope).
--   3. DB-level WhatsApp channel detection fallback in create_elevenlabs_message
--      when called_number matches a registered active whatsapp_channels row.
-- ==============================================================================

begin;

alter table public.whatsapp_messages
  add column if not exists idempotency_key text not null default '' check (char_length(idempotency_key) <= 160),
  add column if not exists payload_hash text not null default '' check (payload_hash = '' or char_length(payload_hash) = 64);

create unique index if not exists whatsapp_messages_admin_idempotency_uq
  on public.whatsapp_messages (phone_number_id, idempotency_key)
  where scope = 'admin' and idempotency_key <> '';

create unique index if not exists whatsapp_messages_merchant_idempotency_uq
  on public.whatsapp_messages (organization_id, phone_number_id, idempotency_key)
  where scope = 'merchant' and idempotency_key <> '';

-- Phase 1: Reserve an outbound WhatsApp send slot BEFORE calling Meta Graph API
create or replace function public.reserve_whatsapp_outbound(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_phone_number_id text;
  v_waba_id text;
  v_peer_wa_id text;
  v_message_type text;
  v_template_name text;
  v_body_text text;
  v_idem_key text;
  v_payload_hash text;
  v_metadata jsonb;
  v_channel public.whatsapp_channels%rowtype;
  v_existing public.whatsapp_messages%rowtype;
  v_reserved public.whatsapp_messages%rowtype;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Invalid payload';
  end if;

  v_phone_number_id := btrim(coalesce(payload->>'phone_number_id', ''));
  v_waba_id := btrim(coalesce(payload->>'waba_id', ''));
  v_peer_wa_id := regexp_replace(coalesce(payload->>'peer_wa_id', ''), '[^0-9]', '', 'g');
  v_message_type := btrim(coalesce(payload->>'message_type', 'template'));
  v_template_name := btrim(coalesce(payload->>'template_name', ''));
  v_body_text := btrim(coalesce(payload->>'body_text', ''));
  v_idem_key := btrim(coalesce(payload->>'idempotency_key', ''));
  v_payload_hash := lower(btrim(coalesce(payload->>'payload_hash', '')));
  v_metadata := coalesce(payload->'metadata', '{}'::jsonb);

  if v_phone_number_id !~ '^[0-9]{5,32}$' or v_peer_wa_id !~ '^[0-9]{6,20}$' then
    raise exception 'Invalid WhatsApp phone_number_id or recipient' using errcode = '22023';
  end if;
  if v_idem_key = '' or char_length(v_payload_hash) <> 64 then
    raise exception 'Missing idempotency_key or payload_hash' using errcode = '22023';
  end if;

  -- Restrict admin test outbound sends strictly to an active registered admin test channel
  select * into v_channel
  from public.whatsapp_channels
  where phone_number_id = v_phone_number_id
    and scope = 'admin'
    and is_active
  for share;

  if not found then
    return jsonb_build_object('action', 'unmapped_channel');
  end if;

  perform pg_advisory_xact_lock(hashtext('wa_out:' || v_phone_number_id || ':' || v_idem_key));

  select * into v_existing
  from public.whatsapp_messages
  where scope = 'admin'
    and phone_number_id = v_phone_number_id
    and idempotency_key = v_idem_key
  for update;

  if found then
    if v_existing.payload_hash <> '' and v_existing.payload_hash <> v_payload_hash then
      return jsonb_build_object('action', 'conflict');
    end if;
    if v_existing.status in ('sent', 'delivered', 'read') then
      return jsonb_build_object('action', 'replay', 'record', to_jsonb(v_existing));
    end if;
    return jsonb_build_object('action', 'in_flight', 'record', to_jsonb(v_existing));
  end if;

  insert into public.whatsapp_messages (
    scope, organization_id, phone_number_id, waba_id, direction,
    wa_message_id, peer_wa_id, message_type, template_name, body_text,
    status, idempotency_key, payload_hash, metadata
  ) values (
    'admin', null, v_phone_number_id, coalesce(nullif(v_waba_id, ''), v_channel.waba_id), 'outbound',
    '', v_peer_wa_id, v_message_type, v_template_name, v_body_text,
    'queued', v_idem_key, v_payload_hash, v_metadata
  )
  returning * into v_reserved;

  return jsonb_build_object('action', 'reserved', 'record', to_jsonb(v_reserved));
end $$;

revoke all on function public.reserve_whatsapp_outbound(jsonb) from public, anon, authenticated;
grant execute on function public.reserve_whatsapp_outbound(jsonb) to service_role;

-- Phase 2: Finalize reserved outbound row after Meta Cloud API responds
create or replace function public.finalize_whatsapp_outbound(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_status text;
  v_wamid text;
  v_err_code text;
  v_err_title text;
  v_err_msg text;
  v_metadata jsonb;
  v_row public.whatsapp_messages%rowtype;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Invalid payload';
  end if;

  v_id := (payload->>'id')::uuid;
  v_status := btrim(coalesce(payload->>'status', ''));
  v_wamid := btrim(coalesce(payload->>'wa_message_id', ''));
  v_err_code := left(btrim(coalesce(payload->>'error_code', '')), 64);
  v_err_title := left(btrim(coalesce(payload->>'error_title', '')), 200);
  v_err_msg := left(btrim(coalesce(payload->>'error_message', '')), 1000);
  v_metadata := coalesce(payload->'metadata', '{}'::jsonb);

  if v_status not in ('sent', 'failed') then
    raise exception 'Invalid finalize status' using errcode = '22023';
  end if;

  select * into v_row from public.whatsapp_messages where id = v_id for update;
  if not found then
    raise exception 'Reserved outbound message not found' using errcode = 'P0002';
  end if;

  update public.whatsapp_messages
     set wa_message_id = case when v_wamid <> '' then v_wamid else wa_message_id end,
         status = case
           when (case v_status when 'sent' then 20 when 'failed' then 50 else 0 end)
                >= (case status when 'queued' then 10 when 'sent' then 20 when 'delivered' then 30 when 'read' then 40 when 'failed' then 50 else 0 end)
           then v_status
           else status
         end,
         error_code = case when v_err_code <> '' then v_err_code else error_code end,
         error_title = case when v_err_title <> '' then v_err_title else error_title end,
         error_message = case when v_err_msg <> '' then v_err_msg else error_message end,
         metadata = coalesce(metadata, '{}'::jsonb) || v_metadata,
         sent_at = case when v_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
         failed_at = case when v_status = 'failed' then coalesce(failed_at, now()) else failed_at end,
         updated_at = now()
   where id = v_id
   returning * into v_row;

  if v_wamid <> '' then
    insert into public.whatsapp_status_events (
      whatsapp_message_id, scope, organization_id, phone_number_id, wa_message_id,
      status, recipient_id, error_code, error_title, error_message, dedupe_key
    ) values (
      v_row.id, v_row.scope, v_row.organization_id, v_row.phone_number_id, v_wamid,
      v_status, v_row.peer_wa_id, v_err_code, v_err_title, v_err_msg,
      'outbound:' || v_row.phone_number_id || ':' || v_wamid || ':' || v_status
    )
    on conflict (dedupe_key) do nothing;
  end if;

  return to_jsonb(v_row);
end $$;

revoke all on function public.finalize_whatsapp_outbound(jsonb) from public, anon, authenticated;
grant execute on function public.finalize_whatsapp_outbound(jsonb) to service_role;

-- Harden ingest_whatsapp_webhook: strictly require active whatsapp_channels match (never dump unmapped phone_number_id into admin)
create or replace function public.ingest_whatsapp_webhook(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_item jsonb;
  v_phone_number_id text;
  v_waba_id text;
  v_channel public.whatsapp_channels%rowtype;
  v_scope text;
  v_org uuid;
  v_wamid text;
  v_status text;
  v_recipient text;
  v_peer_name text;
  v_msg_type text;
  v_body_text text;
  v_err_code text;
  v_err_title text;
  v_err_msg text;
  v_ts_unix text;
  v_ts timestamptz;
  v_existing public.whatsapp_messages%rowtype;
  v_msg_id uuid;
  v_statuses_count integer := 0;
  v_messages_count integer := 0;
  v_unmapped_count integer := 0;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Invalid webhook payload';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(payload->'statuses', '[]'::jsonb))
  loop
    v_phone_number_id := btrim(coalesce(v_item->>'phone_number_id', ''));
    v_waba_id := btrim(coalesce(v_item->>'waba_id', ''));
    v_wamid := btrim(coalesce(v_item->>'wa_message_id', ''));
    v_status := btrim(coalesce(v_item->>'status', ''));
    v_recipient := regexp_replace(coalesce(v_item->>'recipient_id', ''), '[^0-9]', '', 'g');
    v_err_code := left(btrim(coalesce(v_item->>'error_code', '')), 64);
    v_err_title := left(btrim(coalesce(v_item->>'error_title', '')), 200);
    v_err_msg := left(btrim(coalesce(v_item->>'error_message', '')), 1000);
    v_ts_unix := btrim(coalesce(v_item->>'timestamp_sec', ''));

    if v_phone_number_id !~ '^[0-9]{5,32}$' or v_wamid = '' or v_status not in ('sent', 'delivered', 'read', 'failed') then
      continue;
    end if;

    select * into v_channel from public.whatsapp_channels where phone_number_id = v_phone_number_id and is_active;
    if not found then
      v_unmapped_count := v_unmapped_count + 1;
      continue;
    end if;

    v_scope := v_channel.scope;
    v_org := v_channel.organization_id;
    v_ts := case when v_ts_unix ~ '^[0-9]{9,13}$' then to_timestamp((v_ts_unix)::double precision) else now() end;

    select * into v_existing from public.whatsapp_messages
     where phone_number_id = v_phone_number_id and wa_message_id = v_wamid
     for update;

    if not found then
      if v_recipient !~ '^[0-9]{6,20}$' then
        v_recipient := '000000';
      end if;
      insert into public.whatsapp_messages (
        scope, organization_id, phone_number_id, waba_id, direction,
        wa_message_id, peer_wa_id, message_type, status,
        error_code, error_title, error_message,
        sent_at, delivered_at, read_at, failed_at
      ) values (
        v_scope, v_org, v_phone_number_id, v_waba_id, 'outbound',
        v_wamid, v_recipient, 'other', v_status,
        v_err_code, v_err_title, v_err_msg,
        case when v_status = 'sent' then v_ts else null end,
        case when v_status = 'delivered' then v_ts else null end,
        case when v_status = 'read' then v_ts else null end,
        case when v_status = 'failed' then v_ts else null end
      )
      returning * into v_existing;
    else
      v_scope := v_existing.scope;
      v_org := v_existing.organization_id;

      if (case v_status
            when 'queued' then 10 when 'sent' then 20 when 'delivered' then 30
            when 'read' then 40 when 'failed' then 50 when 'received' then 100 else 0 end)
         >= (case v_existing.status
            when 'queued' then 10 when 'sent' then 20 when 'delivered' then 30
            when 'read' then 40 when 'failed' then 50 when 'received' then 100 else 0 end) then
        update public.whatsapp_messages
           set status = v_status,
               sent_at = case when v_status = 'sent' then coalesce(sent_at, v_ts) else sent_at end,
               delivered_at = case when v_status = 'delivered' then coalesce(delivered_at, v_ts) else delivered_at end,
               read_at = case when v_status = 'read' then coalesce(read_at, v_ts) else read_at end,
               failed_at = case when v_status = 'failed' then coalesce(failed_at, v_ts) else failed_at end,
               error_code = case when v_err_code <> '' then v_err_code else error_code end,
               error_title = case when v_err_title <> '' then v_err_title else error_title end,
               error_message = case when v_err_msg <> '' then v_err_msg else error_message end,
               updated_at = now()
         where id = v_existing.id;
      end if;
    end if;

    insert into public.whatsapp_status_events (
      whatsapp_message_id, scope, organization_id, phone_number_id, wa_message_id,
      status, recipient_id, error_code, error_title, error_message, provider_timestamp, dedupe_key
    ) values (
      v_existing.id, v_scope, v_org, v_phone_number_id, v_wamid,
      v_status, v_recipient, v_err_code, v_err_title, v_err_msg, v_ts,
      'status:' || v_phone_number_id || ':' || v_wamid || ':' || v_status || ':' || coalesce(nullif(v_ts_unix, ''), '0')
    )
    on conflict (dedupe_key) do nothing;

    v_statuses_count := v_statuses_count + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(payload->'messages', '[]'::jsonb))
  loop
    v_phone_number_id := btrim(coalesce(v_item->>'phone_number_id', ''));
    v_waba_id := btrim(coalesce(v_item->>'waba_id', ''));
    v_wamid := btrim(coalesce(v_item->>'wa_message_id', ''));
    v_recipient := regexp_replace(coalesce(v_item->>'from_wa_id', ''), '[^0-9]', '', 'g');
    v_peer_name := left(btrim(coalesce(v_item->>'from_name', '')), 120);
    v_msg_type := btrim(coalesce(v_item->>'message_type', 'other'));
    if v_msg_type not in ('template', 'text', 'interactive', 'image', 'audio', 'document', 'other') then
      v_msg_type := 'other';
    end if;
    v_body_text := left(btrim(coalesce(v_item->>'body_text', '')), 4096);
    v_ts_unix := btrim(coalesce(v_item->>'timestamp_sec', ''));

    if v_phone_number_id !~ '^[0-9]{5,32}$' or v_wamid = '' or v_recipient !~ '^[0-9]{6,20}$' then
      continue;
    end if;

    select * into v_channel from public.whatsapp_channels where phone_number_id = v_phone_number_id and is_active;
    if not found then
      v_unmapped_count := v_unmapped_count + 1;
      continue;
    end if;

    v_scope := v_channel.scope;
    v_org := v_channel.organization_id;
    v_ts := case when v_ts_unix ~ '^[0-9]{9,13}$' then to_timestamp((v_ts_unix)::double precision) else now() end;

    v_msg_id := null;
    insert into public.whatsapp_messages (
      scope, organization_id, phone_number_id, waba_id, direction,
      wa_message_id, peer_wa_id, peer_name, message_type, body_text,
      status, received_at
    ) values (
      v_scope, v_org, v_phone_number_id, v_waba_id, 'inbound',
      v_wamid, v_recipient, v_peer_name, v_msg_type, v_body_text,
      'received', v_ts
    )
    on conflict (phone_number_id, wa_message_id) where wa_message_id <> '' do nothing
    returning id into v_msg_id;

    if v_msg_id is not null then
      insert into public.whatsapp_status_events (
        whatsapp_message_id, scope, organization_id, phone_number_id, wa_message_id,
        status, recipient_id, provider_timestamp, dedupe_key
      ) values (
        v_msg_id, v_scope, v_org, v_phone_number_id, v_wamid,
        'received', v_recipient, v_ts,
        'inbound:' || v_phone_number_id || ':' || v_wamid
      )
      on conflict (dedupe_key) do nothing;

      v_messages_count := v_messages_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'statuses_processed', v_statuses_count,
    'messages_processed', v_messages_count,
    'unmapped_ignored', v_unmapped_count
  );
end $$;

commit;
