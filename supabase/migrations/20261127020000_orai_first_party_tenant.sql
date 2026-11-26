-- ==============================================================================
-- Orai Service — First-party Tenant Architecture Alignment
-- Migration: 20261127020000_orai_first_party_tenant.sql
-- Description:
--   1. Unifies create_elevenlabs_message on strict per-agent hashed credentials
--      (auth_mode = 'agent_token'), removing the special 'marketing' bypass.
--   2. Restricts message_inbox_command mutations strictly to active tenant
--      customer_admin members (Super Admin only handles SaaS governance).
--   3. Permits scoped historical admin -> merchant backfill inside
--      guard_message_immutability ONLY when transactional GUC
--      'orai.migrating_admin_inbox' = '1' while preserving all message content
--      and ownership integrity.
--   4. Adds idempotent service-only RPC provision_orai_first_party_tenant(jsonb)
--      to bind Orai's ElevenLabs agent and safely migrate existing admin
--      messages, events, internal notes, and notifications.
-- ==============================================================================

begin;

create or replace function private.guard_message_immutability() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_migrating boolean := current_setting('orai.migrating_admin_inbox', true) = '1'
    and old.inbox_scope = 'admin'
    and old.organization_id is null
    and new.inbox_scope = 'merchant'
    and new.organization_id is not null;
begin
  if new.id is distinct from old.id
    or new.message_no is distinct from old.message_no
    or new.provider is distinct from old.provider
    or new.provider_agent_id is distinct from old.provider_agent_id
    or new.provider_conversation_id is distinct from old.provider_conversation_id
    or new.channel is distinct from old.channel
    or new.sender_name is distinct from old.sender_name
    or new.contact_phone is distinct from old.contact_phone
    or new.recipient_name is distinct from old.recipient_name
    or new.message_content is distinct from old.message_content
    or new.message_summary is distinct from old.message_summary
    or new.category is distinct from old.category
    or new.preferred_callback_time is distinct from old.preferred_callback_time
    or new.idempotency_key is distinct from old.idempotency_key
    or new.payload_hash is distinct from old.payload_hash
    or new.created_at is distinct from old.created_at then
    raise exception 'Message original content and ownership are immutable' using errcode = '23514';
  end if;

  if not v_migrating then
    if new.inbox_scope is distinct from old.inbox_scope
      or new.organization_id is distinct from old.organization_id
      or new.agent_id is distinct from old.agent_id then
      raise exception 'Message original content and ownership are immutable' using errcode = '23514';
    end if;
    if new.conversation_id is distinct from old.conversation_id then
      if old.conversation_id is not null or new.inbox_scope <> 'merchant' then
        raise exception 'Message conversation link cannot be reassigned' using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end $$;

create or replace function public.create_elevenlabs_message(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_auth_mode text;
  v_token_hash text;
  v_claimed_agent_id text;
  v_provider_agent_id text;
  v_provider_conv_id text;
  v_called_number text;
  v_channel text;
  v_sender_name text;
  v_contact_phone text;
  v_recipient_name text;
  v_message_content text;
  v_message_summary text;
  v_category text;
  v_callback_time text;
  v_idem_key text;
  v_hash text;
  v_org uuid;
  v_agent uuid;
  v_cred_id uuid;
  v_conv uuid;
  v_existing public.messages%rowtype;
  v_created public.messages%rowtype;
  v_event_id uuid;
  v_notify_title text;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Invalid message payload';
  end if;

  v_auth_mode := btrim(coalesce(payload->>'auth_mode', ''));
  v_token_hash := lower(btrim(coalesce(payload->>'credential_token_hash', '')));
  v_claimed_agent_id := btrim(coalesce(payload->>'claimed_provider_agent_id', ''));
  v_provider_conv_id := btrim(coalesce(payload->>'provider_conversation_id', ''));
  v_called_number := regexp_replace(coalesce(payload->>'called_number', ''), '[^0-9]', '', 'g');
  v_channel := btrim(coalesce(payload->>'channel', 'web'));
  v_sender_name := btrim(coalesce(payload->>'sender_name', ''));
  v_contact_phone := btrim(coalesce(payload->>'contact_phone', ''));
  v_recipient_name := btrim(coalesce(payload->>'recipient_name', ''));
  v_message_content := btrim(coalesce(payload->>'message_content', ''));
  v_message_summary := btrim(coalesce(payload->>'message_summary', ''));
  v_category := btrim(coalesce(payload->>'category', ''));
  v_callback_time := btrim(coalesce(payload->>'preferred_callback_time', ''));
  v_idem_key := btrim(coalesce(payload->>'idempotency_key', ''));
  v_hash := btrim(coalesce(payload->>'payload_hash', ''));

  if v_sender_name = '' or v_message_content = '' or v_idem_key = '' or char_length(v_hash) <> 64 then
    raise exception 'Missing required message fields' using errcode = '22023';
  end if;

  -- DB-level WhatsApp fallback: if called_number matches an active registered whatsapp_channels row, classify as whatsapp
  if v_channel <> 'whatsapp' and v_called_number ~ '^[0-9]{5,32}$' then
    if exists (
      select 1 from public.whatsapp_channels wc
      where wc.phone_number_id = v_called_number and wc.is_active
    ) then
      v_channel := 'whatsapp';
    end if;
  end if;

  -- All tools, including Orai first-party agent, authenticate via bound agent_tool_credentials hashes
  if v_auth_mode <> 'agent_token' or char_length(v_token_hash) <> 64 then
    return jsonb_build_object('ok', false, 'error_code', 'unauthorized');
  end if;

  select c.id, a.id, a.organization_id, a.elevenlabs_agent_id
    into v_cred_id, v_agent, v_org, v_provider_agent_id
  from public.agent_tool_credentials c
  join public.agents a on a.id = c.agent_id and a.organization_id = c.organization_id
  join public.organizations o on o.id = c.organization_id
  where c.secret_hash = v_token_hash
    and c.tool_name = 'create_message'
    and c.is_active
    and a.status = 'active'
    and o.status = 'active'
  for share of c, a, o;

  if v_cred_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'unauthorized');
  end if;
  if btrim(coalesce(v_provider_agent_id, '')) = '' then
    return jsonb_build_object('ok', false, 'error_code', 'unknown_agent');
  end if;
  if v_claimed_agent_id <> '' and v_claimed_agent_id <> v_provider_agent_id then
    return jsonb_build_object('ok', false, 'error_code', 'agent_mismatch');
  end if;

  update public.agent_tool_credentials
     set last_used_at = now()
   where id = v_cred_id;

  perform pg_advisory_xact_lock(hashtext(v_org::text || ':' || v_idem_key));

  select * into v_existing from public.messages
  where inbox_scope = 'merchant'
    and organization_id = v_org
    and idempotency_key = v_idem_key;

  if found then
    if v_existing.payload_hash <> v_hash then
      raise exception using errcode = 'P0001', message = 'conflict: idempotency key reused';
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'message', to_jsonb(v_existing));
  end if;

  if v_provider_conv_id <> '' then
    select c.id into v_conv
    from public.conversations c
    where c.organization_id = v_org
      and c.provider = 'elevenlabs'
      and c.provider_conversation_id = v_provider_conv_id
    limit 1;
  end if;

  insert into public.messages (
    inbox_scope, organization_id, agent_id, conversation_id,
    provider, provider_agent_id, provider_conversation_id, channel,
    sender_name, contact_phone, recipient_name, message_content, message_summary,
    category, preferred_callback_time, idempotency_key, payload_hash
  ) values (
    'merchant', v_org, v_agent, v_conv,
    'elevenlabs', v_provider_agent_id, v_provider_conv_id, v_channel,
    v_sender_name, v_contact_phone, v_recipient_name, v_message_content, v_message_summary,
    v_category, v_callback_time, v_idem_key, v_hash
  )
  returning * into v_created;

  insert into public.message_events (message_id, inbox_scope, organization_id, actor_label, kind, to_status, detail)
  values (v_created.id, 'merchant', v_org, 'AI 專員', 'created', 'pending', v_created.message_summary)
  returning id into v_event_id;

  if v_conv is not null then
    insert into public.message_events (message_id, inbox_scope, organization_id, actor_label, kind, detail)
    values (v_created.id, 'merchant', v_org, '系統自動關聯', 'conversation_linked', v_conv::text);
  end if;

  v_notify_title := format('新留言 %s：來自 %s', v_created.reference, v_created.sender_name);

  insert into public.notifications (recipient_id, kind, message_id, organization_id, title, event_key)
  select m.profile_id, 'message', v_created.id, v_org, v_notify_title, 'msg:' || v_event_id::text
  from public.organization_members m
  where m.organization_id = v_org and m.is_active
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'replayed', false, 'message', to_jsonb(v_created));
end $$;

revoke all on function public.create_elevenlabs_message(jsonb) from public, anon, authenticated;
grant execute on function public.create_elevenlabs_message(jsonb) to service_role;

-- Super Admin no longer operates daily message inboxes; only active customer_admin members of owning tenant may mutate
create or replace function public.message_inbox_command(actor_id uuid, tenant_id uuid, operation text, payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_actor_label text;
  v_msg public.messages%rowtype;
  v_id uuid;
  v_prev_status text;
  v_next_status text;
  v_note text;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Invalid payload';
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), p.email)
    into v_actor_label
  from public.profiles p
  where p.id = actor_id;

  if v_actor_label is null or tenant_id is null or not exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.profile_id = actor_id
      and m.organization_id = tenant_id
      and m.role = 'customer_admin'
      and m.is_active
      and o.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Not authorized';
  end if;

  v_id := (payload->>'id')::uuid;

  select * into v_msg from public.messages
  where id = v_id and inbox_scope = 'merchant' and organization_id = tenant_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Message unavailable';
  end if;

  if operation = 'add_note' then
    v_note := btrim(coalesce(payload->>'note', ''));
    if char_length(v_note) < 1 or char_length(v_note) > 2000 then
      raise exception 'Note must be between 1 and 2000 characters' using errcode = '22023';
    end if;
    insert into public.message_internal_notes (message_id, inbox_scope, organization_id, actor_id, actor_label, note)
    values (v_msg.id, v_msg.inbox_scope, v_msg.organization_id, actor_id, coalesce(v_actor_label, ''), v_note);
    insert into public.message_events (message_id, inbox_scope, organization_id, actor_id, actor_label, kind, detail)
    values (v_msg.id, v_msg.inbox_scope, v_msg.organization_id, actor_id, coalesce(v_actor_label, ''), 'note_added', v_note);
    return to_jsonb(v_msg);
  elsif operation = 'update_status' then
    if (payload->>'expected_version')::integer is distinct from v_msg.version then
      raise exception 'conflict: message changed; refresh first';
    end if;
    v_next_status := btrim(coalesce(payload->>'status', ''));
    if v_next_status not in ('pending', 'in_progress', 'completed') then
      raise exception 'Invalid status' using errcode = '23514';
    end if;
    if v_next_status = v_msg.status then
      raise exception 'Status unchanged' using errcode = '22023';
    end if;
    v_prev_status := v_msg.status;
    update public.messages
       set status = v_next_status,
           version = version + 1,
           updated_at = now(),
           completed_at = case when v_next_status = 'completed' then now() else null end
     where id = v_msg.id
     returning * into v_msg;
    insert into public.message_events (message_id, inbox_scope, organization_id, actor_id, actor_label, kind, from_status, to_status)
    values (v_msg.id, v_msg.inbox_scope, v_msg.organization_id, actor_id, coalesce(v_actor_label, ''), 'status_changed', v_prev_status, v_next_status);
    return to_jsonb(v_msg);
  else
    raise exception 'Unsupported operation' using errcode = '22023';
  end if;
end $$;

revoke all on function public.message_inbox_command(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.message_inbox_command(uuid, uuid, text, jsonb) to service_role;

-- Service-only idempotent provisioning & historical backfill for Orai First-party Tenant
create or replace function public.provision_orai_first_party_tenant(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_org_name text;
  v_org_slug text;
  v_el_agent_id text;
  v_agent_name text;
  v_member_id uuid;
  v_secret_hash text;
  v_secret_prefix text;
  v_org_id uuid;
  v_agent_id uuid;
  v_msg_ids uuid[];
  v_migrated_msgs integer := 0;
  v_migrated_events integer := 0;
  v_migrated_notes integer := 0;
  v_migrated_notifs integer := 0;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Invalid payload';
  end if;

  v_org_name := btrim(coalesce(payload->>'org_name', 'Orai Service'));
  v_org_slug := lower(btrim(coalesce(payload->>'org_slug', 'orai-service')));
  v_el_agent_id := btrim(coalesce(payload->>'elevenlabs_agent_id', ''));
  v_agent_name := btrim(coalesce(payload->>'agent_name', 'Orai Service 官方 AI 接待專員'));
  v_member_id := (payload->>'member_profile_id')::uuid;
  v_secret_hash := lower(btrim(coalesce(payload->>'secret_hash', '')));
  v_secret_prefix := left(btrim(coalesce(payload->>'secret_prefix', '')), 16);

  if v_org_slug !~ '^[a-z0-9][a-z0-9-]{0,62}$' or v_el_agent_id !~ '^[A-Za-z0-9_-]{6,128}$' or v_member_id is null then
    raise exception 'Invalid organization or agent provisioning parameters' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = v_member_id) then
    raise exception 'Member profile not found' using errcode = 'P0002';
  end if;

  insert into public.organizations (name, slug, industry, status)
  values (v_org_name, v_org_slug, 'other', 'active')
  on conflict (slug) do update
    set name = excluded.name,
        status = 'active',
        updated_at = now()
  returning id into v_org_id;

  insert into public.organization_members (organization_id, profile_id, role, is_active)
  values (v_org_id, v_member_id, 'customer_admin', true)
  on conflict (organization_id, profile_id) do update
    set role = 'customer_admin',
        is_active = true,
        updated_at = now();

  select a.id into v_agent_id
  from public.agents a
  where a.elevenlabs_agent_id = v_el_agent_id
  for update;

  if v_agent_id is null then
    insert into public.agents (organization_id, elevenlabs_agent_id, name, language_mode, status)
    values (v_org_id, v_el_agent_id, v_agent_name, 'trilingual', 'active')
    returning id into v_agent_id;
  elsif not exists (select 1 from public.agents a where a.id = v_agent_id and a.organization_id = v_org_id) then
    raise exception 'ElevenLabs agent ID is already owned by another organization' using errcode = '23505';
  end if;

  if char_length(v_secret_hash) = 64 then
    if not exists (
      select 1 from public.agent_tool_credentials c
      where c.agent_id = v_agent_id
        and c.tool_name = 'create_message'
        and c.secret_hash = v_secret_hash
        and c.is_active
    ) then
      perform public.set_agent_tool_credential(v_agent_id, v_secret_hash, v_secret_prefix);
    end if;
  end if;

  select array_agg(m.id)
    into v_msg_ids
  from public.messages m
  where m.inbox_scope = 'admin'
    and m.provider_agent_id = v_el_agent_id;

  if coalesce(array_length(v_msg_ids, 1), 0) > 0 then
    perform set_config('orai.migrating_admin_inbox', '1', true);

    update public.messages m
       set inbox_scope = 'merchant',
           organization_id = v_org_id,
           agent_id = v_agent_id,
           conversation_id = (
             select c.id
             from public.conversations c
             where c.organization_id = v_org_id
               and c.provider = 'elevenlabs'
               and c.provider_conversation_id = m.provider_conversation_id
               and m.provider_conversation_id <> ''
             limit 1
           )
     where m.id = any(v_msg_ids);
    get diagnostics v_migrated_msgs = row_count;

    update public.message_events
       set inbox_scope = 'merchant',
           organization_id = v_org_id
     where message_id = any(v_msg_ids)
       and inbox_scope = 'admin';
    get diagnostics v_migrated_events = row_count;

    update public.message_internal_notes
       set inbox_scope = 'merchant',
           organization_id = v_org_id
     where message_id = any(v_msg_ids)
       and inbox_scope = 'admin';
    get diagnostics v_migrated_notes = row_count;

    update public.notifications n
       set recipient_id = v_member_id,
           organization_id = v_org_id
     where n.message_id = any(v_msg_ids)
       and n.kind = 'message'
       and n.organization_id is null
       and not exists (
         select 1 from public.notifications existing
         where existing.recipient_id = v_member_id
           and existing.event_key = n.event_key
       );
    get diagnostics v_migrated_notifs = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'organization_id', v_org_id,
    'agent_id', v_agent_id,
    'elevenlabs_agent_id', v_el_agent_id,
    'migrated_messages', v_migrated_msgs,
    'migrated_events', v_migrated_events,
    'migrated_internal_notes', v_migrated_notes,
    'migrated_notifications', v_migrated_notifs
  );
end $$;

revoke all on function public.provision_orai_first_party_tenant(jsonb) from public, anon, authenticated;
grant execute on function public.provision_orai_first_party_tenant(jsonb) to service_role;

commit;
