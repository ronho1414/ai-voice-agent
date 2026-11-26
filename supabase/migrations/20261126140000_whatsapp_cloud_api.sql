-- ==============================================================================
-- Orai Service — WhatsApp Cloud API Staging Integration V1
-- Migration: 20261126140000_whatsapp_cloud_api.sql
-- Description: Multi-tenant / admin-scoped WhatsApp channel bindings, outbound &
--              inbound message tracking, delivery status events, and strict RLS.
-- ==============================================================================

begin;

create table if not exists public.whatsapp_channels (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('admin', 'merchant')),
  organization_id uuid references public.organizations(id) on delete cascade,
  phone_number_id text not null check (phone_number_id ~ '^[0-9]{5,32}$'),
  waba_id text not null default '' check (waba_id = '' or waba_id ~ '^[0-9]{5,32}$'),
  display_phone text not null default '' check (char_length(display_phone) <= 32),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_channels_scope_org_ck check (
    (scope = 'admin' and organization_id is null)
    or (scope = 'merchant' and organization_id is not null)
  )
);

create unique index if not exists whatsapp_channels_phone_number_uq
  on public.whatsapp_channels (phone_number_id);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('admin', 'merchant')),
  organization_id uuid references public.organizations(id) on delete cascade,
  phone_number_id text not null check (phone_number_id ~ '^[0-9]{5,32}$'),
  waba_id text not null default '' check (waba_id = '' or waba_id ~ '^[0-9]{5,32}$'),
  direction text not null check (direction in ('outbound', 'inbound')),
  wa_message_id text not null default '' check (char_length(wa_message_id) <= 160),
  peer_wa_id text not null check (peer_wa_id ~ '^[0-9]{6,20}$'),
  peer_name text not null default '' check (char_length(peer_name) <= 120),
  message_type text not null check (message_type in ('template', 'text', 'interactive', 'image', 'audio', 'document', 'other')),
  template_name text not null default '' check (char_length(template_name) <= 128),
  body_text text not null default '' check (char_length(body_text) <= 4096),
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  error_code text not null default '' check (char_length(error_code) <= 64),
  error_title text not null default '' check (char_length(error_title) <= 200),
  error_message text not null default '' check (char_length(error_message) <= 1000),
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_messages_scope_org_ck check (
    (scope = 'admin' and organization_id is null)
    or (scope = 'merchant' and organization_id is not null)
  )
);

create unique index if not exists whatsapp_messages_provider_wamid_uq
  on public.whatsapp_messages (phone_number_id, wa_message_id)
  where wa_message_id <> '';

create index if not exists whatsapp_messages_scope_date_idx
  on public.whatsapp_messages (scope, organization_id, created_at desc);

create table if not exists public.whatsapp_status_events (
  id uuid primary key default gen_random_uuid(),
  whatsapp_message_id uuid references public.whatsapp_messages(id) on delete cascade,
  scope text not null check (scope in ('admin', 'merchant')),
  organization_id uuid references public.organizations(id) on delete cascade,
  phone_number_id text not null check (phone_number_id ~ '^[0-9]{5,32}$'),
  wa_message_id text not null check (char_length(wa_message_id) between 1 and 160),
  status text not null check (status in ('sent', 'delivered', 'read', 'failed', 'received')),
  recipient_id text not null default '' check (char_length(recipient_id) <= 32),
  error_code text not null default '' check (char_length(error_code) <= 64),
  error_title text not null default '' check (char_length(error_title) <= 200),
  error_message text not null default '' check (char_length(error_message) <= 1000),
  provider_timestamp timestamptz,
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 240),
  created_at timestamptz not null default now()
);

create unique index if not exists whatsapp_status_events_dedupe_uq
  on public.whatsapp_status_events (dedupe_key);

create index if not exists whatsapp_status_events_msg_date_idx
  on public.whatsapp_status_events (whatsapp_message_id, created_at asc);

-- RLS & strict least-privilege grants
do $$ declare t text; begin
  foreach t in array array['whatsapp_channels', 'whatsapp_messages', 'whatsapp_status_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

drop policy if exists whatsapp_channels_read on public.whatsapp_channels;
create policy whatsapp_channels_read on public.whatsapp_channels for select to authenticated using (
  private.current_session_is_active()
  and (
    private.is_super_admin()
    or (scope = 'merchant' and organization_id in (select private.get_user_organization_ids()))
  )
);

drop policy if exists whatsapp_messages_read on public.whatsapp_messages;
create policy whatsapp_messages_read on public.whatsapp_messages for select to authenticated using (
  private.current_session_is_active()
  and (
    (scope = 'admin' and private.is_super_admin())
    or (scope = 'merchant' and organization_id in (select private.get_user_organization_ids()))
  )
);

drop policy if exists whatsapp_status_events_read on public.whatsapp_status_events;
create policy whatsapp_status_events_read on public.whatsapp_status_events for select to authenticated using (
  private.current_session_is_active()
  and (
    (scope = 'admin' and private.is_super_admin())
    or (scope = 'merchant' and organization_id in (select private.get_user_organization_ids()))
  )
);

-- Service-only RPC to record an outbound WhatsApp Cloud API send attempt
create or replace function public.record_whatsapp_outbound(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_phone_number_id text;
  v_waba_id text;
  v_wa_message_id text;
  v_peer_wa_id text;
  v_message_type text;
  v_template_name text;
  v_body_text text;
  v_status text;
  v_error_code text;
  v_error_title text;
  v_error_message text;
  v_metadata jsonb;
  v_channel public.whatsapp_channels%rowtype;
  v_scope text;
  v_org uuid;
  v_row public.whatsapp_messages%rowtype;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Invalid payload';
  end if;

  v_phone_number_id := btrim(coalesce(payload->>'phone_number_id', ''));
  v_waba_id := btrim(coalesce(payload->>'waba_id', ''));
  v_wa_message_id := btrim(coalesce(payload->>'wa_message_id', ''));
  v_peer_wa_id := regexp_replace(coalesce(payload->>'peer_wa_id', ''), '[^0-9]', '', 'g');
  v_message_type := btrim(coalesce(payload->>'message_type', 'template'));
  v_template_name := btrim(coalesce(payload->>'template_name', ''));
  v_body_text := btrim(coalesce(payload->>'body_text', ''));
  v_status := btrim(coalesce(payload->>'status', 'sent'));
  v_error_code := left(btrim(coalesce(payload->>'error_code', '')), 64);
  v_error_title := left(btrim(coalesce(payload->>'error_title', '')), 200);
  v_error_message := left(btrim(coalesce(payload->>'error_message', '')), 1000);
  v_metadata := coalesce(payload->'metadata', '{}'::jsonb);

  if v_phone_number_id !~ '^[0-9]{5,32}$' or v_peer_wa_id !~ '^[0-9]{6,20}$' then
    raise exception 'Invalid WhatsApp phone_number_id or recipient' using errcode = '22023';
  end if;

  select * into v_channel from public.whatsapp_channels
   where phone_number_id = v_phone_number_id and is_active;
  if found then
    v_scope := v_channel.scope;
    v_org := v_channel.organization_id;
  else
    v_scope := 'admin';
    v_org := null;
  end if;

  if v_wa_message_id <> '' then
    select * into v_row from public.whatsapp_messages
     where phone_number_id = v_phone_number_id and wa_message_id = v_wa_message_id;
    if found then
      return to_jsonb(v_row);
    end if;
  end if;

  insert into public.whatsapp_messages (
    scope, organization_id, phone_number_id, waba_id, direction,
    wa_message_id, peer_wa_id, message_type, template_name, body_text,
    status, error_code, error_title, error_message, metadata,
    sent_at, failed_at
  ) values (
    v_scope, v_org, v_phone_number_id, v_waba_id, 'outbound',
    v_wa_message_id, v_peer_wa_id, v_message_type, v_template_name, v_body_text,
    v_status, v_error_code, v_error_title, v_error_message, v_metadata,
    case when v_status = 'sent' then now() else null end,
    case when v_status = 'failed' then now() else null end
  )
  returning * into v_row;

  if v_wa_message_id <> '' then
    insert into public.whatsapp_status_events (
      whatsapp_message_id, scope, organization_id, phone_number_id, wa_message_id,
      status, recipient_id, error_code, error_title, error_message, dedupe_key
    ) values (
      v_row.id, v_scope, v_org, v_phone_number_id, v_wa_message_id,
      case when v_status = 'failed' then 'failed' else 'sent' end,
      v_peer_wa_id, v_error_code, v_error_title, v_error_message,
      'outbound:' || v_phone_number_id || ':' || v_wa_message_id || ':' || v_status
    )
    on conflict (dedupe_key) do nothing;
  end if;

  return to_jsonb(v_row);
end $$;

revoke all on function public.record_whatsapp_outbound(jsonb) from public, anon, authenticated;
grant execute on function public.record_whatsapp_outbound(jsonb) to service_role;

-- Service-only RPC to ingest verified Meta webhook statuses and inbound messages
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

    v_ts := case when v_ts_unix ~ '^[0-9]{9,13}$' then to_timestamp((v_ts_unix)::double precision) else now() end;

    select * into v_channel from public.whatsapp_channels where phone_number_id = v_phone_number_id and is_active;
    if found then
      v_scope := v_channel.scope;
      v_org := v_channel.organization_id;
    else
      v_scope := 'admin';
      v_org := null;
    end if;

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

    v_ts := case when v_ts_unix ~ '^[0-9]{9,13}$' then to_timestamp((v_ts_unix)::double precision) else now() end;

    select * into v_channel from public.whatsapp_channels where phone_number_id = v_phone_number_id and is_active;
    if found then
      v_scope := v_channel.scope;
      v_org := v_channel.organization_id;
    else
      v_scope := 'admin';
      v_org := null;
    end if;

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
    'messages_processed', v_messages_count
  );
end $$;

revoke all on function public.ingest_whatsapp_webhook(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_webhook(jsonb) to service_role;

commit;
