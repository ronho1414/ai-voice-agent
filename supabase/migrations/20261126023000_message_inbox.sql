-- ==============================================================================
-- Orai Service — AI Message Inbox & Human Follow-up V1
-- Migration: 20261126023000_message_inbox.sql
-- Description: Multi-tenant message inbox (merchant + admin marketing), audit
--              events, internal follow-up notes, notification reuse, RLS, and
--              trusted ElevenLabs server-tool ingestion RPCs.
-- ==============================================================================

begin;

create table if not exists public.agent_tool_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null,
  tool_name text not null default 'create_message' check (tool_name in ('create_message')),
  secret_hash text not null check (char_length(secret_hash) = 64),
  secret_prefix text not null default '' check (char_length(secret_prefix) <= 16),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint agent_tool_credentials_org_agent_fk foreign key (organization_id, agent_id)
    references public.agents(organization_id, id) on delete cascade
);

create unique index if not exists agent_tool_credentials_secret_hash_uq
  on public.agent_tool_credentials (secret_hash);

create unique index if not exists agent_tool_credentials_active_agent_uq
  on public.agent_tool_credentials (agent_id, tool_name)
  where is_active;

alter table public.agent_tool_credentials enable row level security;
revoke all on public.agent_tool_credentials from public, anon, authenticated;
grant all on public.agent_tool_credentials to service_role;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  message_no bigint generated always as identity unique,
  reference text generated always as ('MSG-' || lpad(message_no::text, 6, '0')) stored,
  inbox_scope text not null check (inbox_scope in ('admin', 'merchant')),
  organization_id uuid references public.organizations(id) on delete cascade,
  agent_id uuid,
  conversation_id uuid references public.conversations(id) on delete set null,
  provider text not null default 'elevenlabs' check (provider in ('elevenlabs')),
  provider_agent_id text not null check (length(btrim(provider_agent_id)) > 0 and char_length(provider_agent_id) <= 128),
  provider_conversation_id text not null default '' check (char_length(provider_conversation_id) <= 128),
  channel text not null default 'web' check (channel in ('web', 'phone', 'whatsapp')),
  sender_name text not null check (length(btrim(sender_name)) between 1 and 120),
  contact_phone text not null default '' check (char_length(contact_phone) <= 64),
  recipient_name text not null default '' check (char_length(recipient_name) <= 120),
  message_content text not null check (length(btrim(message_content)) between 1 and 4000),
  message_summary text not null default '' check (char_length(message_summary) <= 600),
  category text not null check (
    category in (
      'general_message',
      'callback_request',
      'complaint',
      'specific_recipient',
      'unanswered_question',
      'business_enquiry'
    )
  ),
  preferred_callback_time text not null default '' check (char_length(preferred_callback_time) <= 160),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  version integer not null default 1 check (version >= 1),
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 160),
  payload_hash text not null check (char_length(payload_hash) = 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint messages_scope_org_ck check (
    (inbox_scope = 'admin' and organization_id is null and agent_id is null and conversation_id is null)
    or (inbox_scope = 'merchant' and organization_id is not null)
  ),
  constraint messages_completed_at_ck check ((status = 'completed') = (completed_at is not null)),
  constraint messages_org_agent_fk foreign key (organization_id, agent_id)
    references public.agents(organization_id, id),
  constraint messages_org_conversation_fk foreign key (organization_id, conversation_id)
    references public.conversations(organization_id, id)
);

create unique index if not exists messages_admin_idempotency_uq
  on public.messages (provider_agent_id, idempotency_key)
  where inbox_scope = 'admin';

create unique index if not exists messages_merchant_idempotency_uq
  on public.messages (organization_id, idempotency_key)
  where inbox_scope = 'merchant';

create index if not exists messages_admin_status_date_idx
  on public.messages (status, created_at desc)
  where inbox_scope = 'admin';

create index if not exists messages_merchant_status_date_idx
  on public.messages (organization_id, status, created_at desc)
  where inbox_scope = 'merchant';

create index if not exists messages_provider_conversation_idx
  on public.messages (provider, provider_conversation_id)
  where provider_conversation_id <> '';

create table if not exists public.message_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  inbox_scope text not null check (inbox_scope in ('admin', 'merchant')),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  actor_label text not null default '' check (char_length(actor_label) <= 120),
  kind text not null check (kind in ('created', 'status_changed', 'note_added', 'conversation_linked')),
  from_status text check (from_status is null or from_status in ('pending', 'in_progress', 'completed')),
  to_status text check (to_status is null or to_status in ('pending', 'in_progress', 'completed')),
  detail text not null default '' check (char_length(detail) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists message_events_message_date_idx
  on public.message_events (message_id, created_at asc);

create table if not exists public.message_internal_notes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  inbox_scope text not null check (inbox_scope in ('admin', 'merchant')),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  actor_label text not null default '' check (char_length(actor_label) <= 120),
  note text not null check (length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists message_internal_notes_message_date_idx
  on public.message_internal_notes (message_id, created_at asc);

-- Reuse existing persistent notification table for message alerts as well as agent requests.
alter table public.notifications alter column request_id drop not null;
alter table public.notifications alter column organization_id drop not null;
alter table public.notifications
  add column if not exists message_id uuid references public.messages(id) on delete cascade,
  add column if not exists kind text not null default 'agent_request';

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('agent_request', 'message'));

alter table public.notifications drop constraint if exists notifications_target_check;
alter table public.notifications add constraint notifications_target_check check (
  (kind = 'agent_request' and request_id is not null and message_id is null and organization_id is not null)
  or (kind = 'message' and message_id is not null and request_id is null)
);

-- RLS & strict least-privilege grants
do $$ declare t text; begin
  foreach t in array array['messages', 'message_events', 'message_internal_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

grant usage, select on sequence public.messages_message_no_seq to service_role;

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (
  (inbox_scope = 'admin' and private.is_super_admin())
  or (inbox_scope = 'merchant' and organization_id in (select private.get_user_organization_ids()))
);

drop policy if exists message_events_read on public.message_events;
create policy message_events_read on public.message_events for select to authenticated using (
  (inbox_scope = 'admin' and private.is_super_admin())
  or (inbox_scope = 'merchant' and organization_id in (select private.get_user_organization_ids()))
);

drop policy if exists message_internal_notes_read on public.message_internal_notes;
create policy message_internal_notes_read on public.message_internal_notes for select to authenticated using (
  (inbox_scope = 'admin' and private.is_super_admin())
  or (inbox_scope = 'merchant' and organization_id in (select private.get_user_organization_ids()))
);

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
  private.current_session_is_active()
  and recipient_id = auth.uid()
  and (
    private.is_super_admin()
    or (organization_id is not null and organization_id in (select private.get_user_organization_ids()))
  )
);

-- Preserve original message content, metadata, and tenant isolation on updates.
create or replace function private.guard_message_immutability() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.id is distinct from old.id
    or new.message_no is distinct from old.message_no
    or new.inbox_scope is distinct from old.inbox_scope
    or new.organization_id is distinct from old.organization_id
    or new.agent_id is distinct from old.agent_id
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
  if new.conversation_id is distinct from old.conversation_id then
    if old.conversation_id is not null or new.inbox_scope <> 'merchant' then
      raise exception 'Message conversation link cannot be reassigned' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_message_immutability on public.messages;
create trigger guard_message_immutability before update on public.messages
  for each row execute function private.guard_message_immutability();

-- Automatically link merchant messages created mid-call when post-call conversation syncs.
create or replace function private.link_messages_on_conversation_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare linked_row record;
begin
  if new.provider = 'elevenlabs' and coalesce(new.provider_conversation_id, '') <> '' then
    for linked_row in
      update public.messages
         set conversation_id = new.id
       where inbox_scope = 'merchant'
         and organization_id = new.organization_id
         and provider = 'elevenlabs'
         and provider_conversation_id = new.provider_conversation_id
         and conversation_id is null
      returning id, organization_id
    loop
      insert into public.message_events (message_id, inbox_scope, organization_id, actor_label, kind, detail)
      values (linked_row.id, 'merchant', linked_row.organization_id, '系統自動關聯', 'conversation_linked', new.id::text);
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists link_messages_on_conversation_sync on public.conversations;
create trigger link_messages_on_conversation_sync after insert on public.conversations
  for each row execute function private.link_messages_on_conversation_sync();

-- Service-only RPC to rotate or set an agent-scoped server tool credential (stored strictly as SHA-256 hash).
create or replace function public.set_agent_tool_credential(
  p_agent_id uuid,
  p_secret_hash text,
  p_secret_prefix text default ''
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_org_id uuid;
  v_cred public.agent_tool_credentials%rowtype;
begin
  if p_agent_id is null or char_length(btrim(coalesce(p_secret_hash, ''))) <> 64 then
    raise exception 'Invalid agent credential parameters' using errcode = '22023';
  end if;

  select a.organization_id into v_org_id
  from public.agents a
  join public.organizations o on o.id = a.organization_id
  where a.id = p_agent_id
    and a.status = 'active'
    and o.status = 'active'
  for update of a;

  if v_org_id is null then
    raise exception 'Active agent not found' using errcode = 'P0002';
  end if;

  update public.agent_tool_credentials
     set is_active = false,
         revoked_at = coalesce(revoked_at, now())
   where agent_id = p_agent_id
     and tool_name = 'create_message'
     and is_active;

  insert into public.agent_tool_credentials (
    organization_id, agent_id, tool_name, secret_hash, secret_prefix, is_active
  ) values (
    v_org_id, p_agent_id, 'create_message', lower(btrim(p_secret_hash)), left(btrim(coalesce(p_secret_prefix, '')), 16), true
  )
  returning * into v_cred;

  return jsonb_build_object(
    'id', v_cred.id,
    'agent_id', v_cred.agent_id,
    'organization_id', v_cred.organization_id,
    'secret_prefix', v_cred.secret_prefix,
    'created_at', v_cred.created_at
  );
end $$;

revoke all on function public.set_agent_tool_credential(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_agent_tool_credential(uuid, text, text) to service_role;

-- Service-only RPC called by /api/tools/elevenlabs/create-message after credential verification.
create or replace function public.create_elevenlabs_message(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_auth_mode text;
  v_token_hash text;
  v_claimed_agent_id text;
  v_provider_agent_id text;
  v_marketing_agent_id text;
  v_provider_conv_id text;
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
  v_scope text;
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
  v_marketing_agent_id := btrim(coalesce(payload->>'marketing_agent_id', ''));
  v_provider_conv_id := btrim(coalesce(payload->>'provider_conversation_id', ''));
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

  if v_auth_mode = 'marketing' then
    if v_marketing_agent_id = '' then
      return jsonb_build_object('ok', false, 'error_code', 'unknown_agent');
    end if;
    if v_claimed_agent_id <> '' and v_claimed_agent_id <> v_marketing_agent_id then
      return jsonb_build_object('ok', false, 'error_code', 'agent_mismatch');
    end if;
    v_scope := 'admin';
    v_org := null;
    v_agent := null;
    v_provider_agent_id := v_marketing_agent_id;
  elsif v_auth_mode = 'agent_token' then
    if char_length(v_token_hash) <> 64 then
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
    if v_marketing_agent_id <> '' and v_provider_agent_id = v_marketing_agent_id then
      return jsonb_build_object('ok', false, 'error_code', 'agent_mismatch');
    end if;
    if v_claimed_agent_id <> '' and v_claimed_agent_id <> v_provider_agent_id then
      return jsonb_build_object('ok', false, 'error_code', 'agent_mismatch');
    end if;

    update public.agent_tool_credentials
       set last_used_at = now()
     where id = v_cred_id;

    v_scope := 'merchant';
  else
    return jsonb_build_object('ok', false, 'error_code', 'unauthorized');
  end if;

  perform pg_advisory_xact_lock(hashtext(coalesce(v_org::text, 'admin:' || v_provider_agent_id) || ':' || v_idem_key));

  if v_scope = 'admin' then
    select * into v_existing from public.messages
    where inbox_scope = 'admin' and provider_agent_id = v_provider_agent_id and idempotency_key = v_idem_key;
  else
    select * into v_existing from public.messages
    where inbox_scope = 'merchant' and organization_id = v_org and idempotency_key = v_idem_key;
  end if;

  if found then
    if v_existing.payload_hash <> v_hash then
      raise exception using errcode = 'P0001', message = 'conflict: idempotency key reused';
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'message', to_jsonb(v_existing));
  end if;

  if v_scope = 'merchant' and v_provider_conv_id <> '' then
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
    v_scope, v_org, v_agent, v_conv,
    'elevenlabs', v_provider_agent_id, v_provider_conv_id, v_channel,
    v_sender_name, v_contact_phone, v_recipient_name, v_message_content, v_message_summary,
    v_category, v_callback_time, v_idem_key, v_hash
  )
  returning * into v_created;

  insert into public.message_events (message_id, inbox_scope, organization_id, actor_label, kind, to_status, detail)
  values (v_created.id, v_scope, v_org, 'AI 專員', 'created', 'pending', v_created.message_summary)
  returning id into v_event_id;

  if v_conv is not null then
    insert into public.message_events (message_id, inbox_scope, organization_id, actor_label, kind, detail)
    values (v_created.id, v_scope, v_org, '系統自動關聯', 'conversation_linked', v_conv::text);
  end if;

  v_notify_title := format('新留言 %s：來自 %s', v_created.reference, v_created.sender_name);

  if v_scope = 'admin' then
    insert into public.notifications (recipient_id, kind, message_id, organization_id, title, event_key)
    select id, 'message', v_created.id, null, v_notify_title, 'msg:' || v_event_id::text
    from public.profiles
    where system_role = 'super_admin'
    on conflict do nothing;
  else
    insert into public.notifications (recipient_id, kind, message_id, organization_id, title, event_key)
    select m.profile_id, 'message', v_created.id, v_org, v_notify_title, 'msg:' || v_event_id::text
    from public.organization_members m
    where m.organization_id = v_org and m.is_active
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'replayed', false, 'message', to_jsonb(v_created));
end $$;

revoke all on function public.create_elevenlabs_message(jsonb) from public, anon, authenticated;
grant execute on function public.create_elevenlabs_message(jsonb) to service_role;

-- Service-only RPC for authorized dashboard/admin inbox status updates and internal notes.
create or replace function public.message_inbox_command(actor_id uuid, tenant_id uuid, operation text, payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_is_admin boolean;
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

  select (p.system_role = 'super_admin'),
         coalesce(nullif(btrim(p.full_name), ''), p.email)
    into v_is_admin, v_actor_label
  from public.profiles p
  where p.id = actor_id;

  if v_is_admin is null then
    raise exception using errcode = '42501', message = 'Not authorized';
  end if;

  v_id := (payload->>'id')::uuid;

  if v_is_admin then
    select * into v_msg from public.messages
    where id = v_id and inbox_scope = 'admin'
    for update;
  else
    if tenant_id is null or not exists (
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

    select * into v_msg from public.messages
    where id = v_id and inbox_scope = 'merchant' and organization_id = tenant_id
    for update;
  end if;

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

commit;
