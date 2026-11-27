-- ==============================================================================
-- Orai Service — WhatsApp Live Inbox, Multi-Tenant Routing & Human Takeover
-- Migration: 20261127080000_whatsapp_live_inbox.sql
-- Rollback safety:
--   All schema changes are strictly additive (plus idempotent RPC replacements)
--   preserving existing whatsapp_channels, whatsapp_messages, whatsapp_status_events,
--   notifications, and ElevenLabs voice/message workflows. Existing US channel
--   keeps ai_auto_reply_enabled = false until explicitly enabled by config.
-- ==============================================================================

begin;

-- 1. Extend whatsapp_channels for multi-tenant agent mapping & opt-in AI auto-reply
alter table public.whatsapp_channels
  add column if not exists agent_id uuid references public.agents(id) on delete set null,
  add column if not exists country_code text not null default '' check (country_code = '' or country_code ~ '^[0-9]{1,4}$'),
  add column if not exists ai_auto_reply_enabled boolean not null default false,
  add column if not exists allow_platform_env_fallback boolean not null default false;

create index if not exists whatsapp_channels_org_idx
  on public.whatsapp_channels (organization_id, is_active);

-- Private per-channel Meta credentials (never readable by anon/authenticated/client Data API)
create table if not exists private.whatsapp_channel_secrets (
  channel_id uuid primary key references public.whatsapp_channels(id) on delete cascade,
  access_token text not null default '',
  app_secret text not null default '',
  verify_token text not null default '',
  updated_at timestamptz not null default now()
);

grant usage on schema private to service_role;
revoke all on table private.whatsapp_channel_secrets from public, anon, authenticated;
grant all on table private.whatsapp_channel_secrets to service_role;

create or replace function public.read_whatsapp_channel_secrets(p_channel_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select coalesce(
    (
      select jsonb_build_object(
        'access_token', s.access_token,
        'app_secret', s.app_secret,
        'verify_token', s.verify_token
      )
      from private.whatsapp_channel_secrets s
      where s.channel_id = p_channel_id
      limit 1
    ),
    '{}'::jsonb
  );
$$;

revoke all on function public.read_whatsapp_channel_secrets(uuid) from public, anon, authenticated;
grant execute on function public.read_whatsapp_channel_secrets(uuid) to service_role;

create or replace function public.list_whatsapp_channel_app_secrets(p_phone_number_ids text[]) returns table (
  phone_number_id text,
  app_secret text
)
language sql security invoker set search_path = '' as $$
  select c.phone_number_id, s.app_secret
  from public.whatsapp_channels c
  join private.whatsapp_channel_secrets s on s.channel_id = c.id
  where c.is_active
    and c.phone_number_id = any(coalesce(p_phone_number_ids, array[]::text[]))
    and s.app_secret <> '';
$$;

revoke all on function public.list_whatsapp_channel_app_secrets(text[]) from public, anon, authenticated;
grant execute on function public.list_whatsapp_channel_app_secrets(text[]) to service_role;

-- 2. Conversation threads & AI / Human takeover state
create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'merchant' check (scope in ('admin', 'merchant')),
  organization_id uuid references public.organizations(id) on delete cascade,
  channel_id uuid not null references public.whatsapp_channels(id) on delete cascade,
  phone_number_id text not null check (phone_number_id ~ '^[0-9]{5,32}$'),
  customer_wa_id text not null check (customer_wa_id ~ '^[0-9]{6,20}$'),
  customer_name text not null default '' check (char_length(customer_name) <= 120),
  mode text not null default 'ai' check (mode in ('ai', 'human')),
  mode_version integer not null default 1 check (mode_version >= 1),
  status text not null default 'open' check (status in ('open', 'needs_human', 'resolved')),
  unread_count integer not null default 0 check (unread_count >= 0),
  assigned_profile_id uuid references public.profiles(id) on delete set null,
  needs_human_reason text not null default '' check (char_length(needs_human_reason) <= 500),
  last_message_preview text not null default '' check (char_length(last_message_preview) <= 300),
  last_message_sender text not null default 'customer' check (last_message_sender in ('customer', 'ai', 'human', 'system')),
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  last_ai_processed_msg_at timestamptz,
  last_ai_processed_msg_id uuid,
  elevenlabs_conversation_id text not null default '' check (char_length(elevenlabs_conversation_id) <= 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_conversations_scope_org_ck check (
    (scope = 'admin' and organization_id is null)
    or (scope = 'merchant' and organization_id is not null)
  ),
  constraint whatsapp_conversations_channel_customer_uq unique (channel_id, customer_wa_id)
);

create index if not exists whatsapp_conversations_org_recent_idx
  on public.whatsapp_conversations (organization_id, last_message_at desc)
  where scope = 'merchant';

create index if not exists whatsapp_conversations_org_status_idx
  on public.whatsapp_conversations (organization_id, status, unread_count)
  where scope = 'merchant';

-- 3. Extend whatsapp_messages cleanly for thread linking, sender attribution & media metadata
alter table public.whatsapp_messages
  add column if not exists whatsapp_conversation_id uuid references public.whatsapp_conversations(id) on delete cascade,
  add column if not exists sender_type text not null default 'customer' check (sender_type in ('customer', 'ai', 'human', 'system')),
  add column if not exists sender_actor_id uuid references public.profiles(id) on delete set null,
  add column if not exists media_metadata jsonb not null default '{}'::jsonb,
  add column if not exists ai_job_id uuid,
  add column if not exists dispatched_before_takeover boolean not null default false;

create index if not exists whatsapp_messages_conv_time_idx
  on public.whatsapp_messages (whatsapp_conversation_id, created_at asc);

-- 4. Immutable audit log for human takeover / resume / resolution / escalation events
create table if not exists public.whatsapp_takeover_events (
  id uuid primary key default gen_random_uuid(),
  whatsapp_conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  scope text not null default 'merchant' check (scope in ('admin', 'merchant')),
  organization_id uuid references public.organizations(id) on delete cascade,
  action text not null check (
    action in (
      'take_over',
      'resume_ai',
      'mark_resolved',
      'reopen',
      'mark_unread',
      'mark_read',
      'ai_escalated',
      'dispatched_before_takeover'
    )
  ),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_label text not null default '' check (char_length(actor_label) <= 120),
  previous_mode text,
  next_mode text,
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_takeover_events_conv_idx
  on public.whatsapp_takeover_events (whatsapp_conversation_id, created_at desc);

-- 5. Sequential durable AI job queue per conversation (service_role only)
create table if not exists public.whatsapp_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  whatsapp_conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  mode_version integer not null check (mode_version >= 1),
  trigger_message_id uuid references public.whatsapp_messages(id) on delete set null,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'completed', 'cancelled_by_takeover', 'failed', 'skipped')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  error_message text not null default '' check (char_length(error_message) <= 1000),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- At most 1 pending/processing AI turn per conversation: guarantees ordering & prevents duplicate concurrent AI replies
create unique index if not exists whatsapp_ai_jobs_active_conv_uq
  on public.whatsapp_ai_jobs (whatsapp_conversation_id)
  where status in ('pending', 'processing');

create index if not exists whatsapp_ai_jobs_pending_idx
  on public.whatsapp_ai_jobs (status, created_at asc)
  where status = 'pending';

-- 6. RLS & Grants
do $$ declare t text; begin
  foreach t in array array['whatsapp_conversations', 'whatsapp_takeover_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

alter table public.whatsapp_ai_jobs enable row level security;
revoke all on table public.whatsapp_ai_jobs from public, anon, authenticated;
grant all on table public.whatsapp_ai_jobs to service_role;

drop policy if exists whatsapp_conversations_read on public.whatsapp_conversations;
create policy whatsapp_conversations_read on public.whatsapp_conversations for select to authenticated using (
  private.current_session_is_active()
  and (
    (scope = 'admin' and private.is_super_admin())
    or (scope = 'merchant' and organization_id in (select private.get_user_organization_ids()))
  )
);

drop policy if exists whatsapp_takeover_events_read on public.whatsapp_takeover_events;
create policy whatsapp_takeover_events_read on public.whatsapp_takeover_events for select to authenticated using (
  private.current_session_is_active()
  and (
    (scope = 'admin' and private.is_super_admin())
    or (scope = 'merchant' and organization_id in (select private.get_user_organization_ids()))
  )
);

-- 7. Extend notifications to support WhatsApp handoff / human-mode / send-failure alerts cleanly
alter table public.notifications
  add column if not exists whatsapp_conversation_id uuid references public.whatsapp_conversations(id) on delete cascade;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('agent_request', 'message', 'whatsapp_handoff'));

alter table public.notifications drop constraint if exists notifications_target_check;
alter table public.notifications add constraint notifications_target_check check (
  (kind = 'agent_request' and request_id is not null and message_id is null and whatsapp_conversation_id is null and organization_id is not null)
  or (kind = 'message' and message_id is not null and request_id is null and whatsapp_conversation_id is null)
  or (kind = 'whatsapp_handoff' and whatsapp_conversation_id is not null and organization_id is not null and request_id is null and message_id is null)
);

-- 8. Upgrade ingest_whatsapp_webhook: strict idempotency, thread upsert, media metadata, queued AI job, and deduped notifications
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
  v_media_meta jsonb;
  v_preview text;
  v_err_code text;
  v_err_title text;
  v_err_msg text;
  v_ts_unix text;
  v_ts timestamptz;
  v_existing public.whatsapp_messages%rowtype;
  v_conv public.whatsapp_conversations%rowtype;
  v_msg_id uuid;
  v_statuses_count integer := 0;
  v_messages_count integer := 0;
  v_unmapped_count integer := 0;
  v_jobs_enqueued integer := 0;
  v_job_id uuid;
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
        scope, organization_id, phone_number_id, waba_id, direction, sender_type,
        wa_message_id, peer_wa_id, message_type, status,
        error_code, error_title, error_message,
        sent_at, delivered_at, read_at, failed_at
      ) values (
        v_scope, v_org, v_phone_number_id, v_waba_id, 'outbound', 'ai',
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

        -- Notify tenant when delivery fails on a conversation thread
        if v_status = 'failed' and v_existing.whatsapp_conversation_id is not null and v_org is not null then
          insert into public.notifications (
            recipient_id, kind, whatsapp_conversation_id, organization_id, title, event_key
          )
          select m.profile_id, 'whatsapp_handoff', v_existing.whatsapp_conversation_id, v_org,
                 format('WhatsApp 訊息發送失敗（%s）', coalesce(nullif(v_err_code, ''), 'META_ERR')),
                 'wa_fail:' || v_existing.id::text
          from public.organization_members m
          where m.organization_id = v_org and m.is_active
          on conflict do nothing;
        end if;
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
    v_media_meta := coalesce(v_item->'media_metadata', '{}'::jsonb);
    v_ts_unix := btrim(coalesce(v_item->>'timestamp_sec', ''));

    if v_phone_number_id !~ '^[0-9]{5,32}$' or v_wamid = '' or v_recipient !~ '^[0-9]{6,20}$' then
      continue;
    end if;

    select * into v_channel from public.whatsapp_channels where phone_number_id = v_phone_number_id and is_active;
    if not found then
      v_unmapped_count := v_unmapped_count + 1;
      continue;
    end if;

    -- Strict webhook idempotency BEFORE touching conversation counters or queueing AI
    if exists (
      select 1 from public.whatsapp_messages
      where phone_number_id = v_phone_number_id and wa_message_id = v_wamid
    ) then
      continue;
    end if;

    v_scope := v_channel.scope;
    v_org := v_channel.organization_id;
    v_ts := case when v_ts_unix ~ '^[0-9]{9,13}$' then to_timestamp((v_ts_unix)::double precision) else now() end;

    v_preview := left(
      coalesce(
        nullif(v_body_text, ''),
        case v_msg_type
          when 'image' then '[圖片訊息]'
          when 'audio' then '[語音訊息]'
          when 'document' then '[文件檔案]'
          when 'interactive' then '[互動回覆]'
          else '[' || v_msg_type || ' 訊息]'
        end
      ),
      300
    );

    perform pg_advisory_xact_lock(hashtext('wa_conv:' || v_channel.id::text || ':' || v_recipient));

    insert into public.whatsapp_conversations (
      scope, organization_id, channel_id, phone_number_id,
      customer_wa_id, customer_name, mode, status, unread_count,
      last_message_preview, last_message_sender, last_message_at, last_inbound_at
    ) values (
      v_scope, v_org, v_channel.id, v_phone_number_id,
      v_recipient, v_peer_name, 'ai', 'open', 1,
      v_preview, 'customer', v_ts, v_ts
    )
    on conflict (channel_id, customer_wa_id) do update
      set customer_name = coalesce(nullif(excluded.customer_name, ''), public.whatsapp_conversations.customer_name),
          unread_count = public.whatsapp_conversations.unread_count + 1,
          status = case
            when public.whatsapp_conversations.mode = 'human' then 'needs_human'
            when public.whatsapp_conversations.status = 'resolved' then 'open'
            else public.whatsapp_conversations.status
          end,
          last_message_preview = excluded.last_message_preview,
          last_message_sender = 'customer',
          last_message_at = greatest(public.whatsapp_conversations.last_message_at, excluded.last_message_at),
          last_inbound_at = greatest(coalesce(public.whatsapp_conversations.last_inbound_at, '-infinity'::timestamptz), excluded.last_inbound_at),
          updated_at = now()
    returning * into v_conv;

    v_msg_id := null;
    insert into public.whatsapp_messages (
      whatsapp_conversation_id, scope, organization_id, phone_number_id, waba_id,
      direction, sender_type, wa_message_id, peer_wa_id, peer_name,
      message_type, body_text, media_metadata, status, received_at
    ) values (
      v_conv.id, v_scope, v_org, v_phone_number_id, v_waba_id,
      'inbound', 'customer', v_wamid, v_recipient, v_peer_name,
      v_msg_type, v_body_text, v_media_meta, 'received', v_ts
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

      if v_scope = 'merchant' and v_org is not null then
        if v_conv.mode = 'ai' and v_channel.ai_auto_reply_enabled and v_channel.agent_id is not null then
          -- Enqueue at most 1 pending/processing AI turn per conversation (coalesces rapid bursts)
          v_job_id := null;
          insert into public.whatsapp_ai_jobs (
            organization_id, whatsapp_conversation_id, agent_id, mode_version, trigger_message_id, status
          ) values (
            v_org, v_conv.id, v_channel.agent_id, v_conv.mode_version, v_msg_id, 'pending'
          )
          on conflict (whatsapp_conversation_id) where status in ('pending', 'processing') do nothing
          returning id into v_job_id;
          if v_job_id is not null then
            v_jobs_enqueued := v_jobs_enqueued + 1;
          end if;
        elsif v_conv.mode = 'human' then
          -- Deduplicated notification for Human Mode inbound customer message (skip if unread alert already pending for same conversation)
          insert into public.notifications (
            recipient_id, kind, whatsapp_conversation_id, organization_id, title, event_key
          )
          select m.profile_id, 'whatsapp_handoff', v_conv.id, v_org,
                 format('WhatsApp 真人對話新訊息：%s', coalesce(nullif(v_conv.customer_name, ''), '+' || v_conv.customer_wa_id)),
                 'wa_human:' || v_conv.id::text || ':' || v_wamid
          from public.organization_members m
          where m.organization_id = v_org
            and m.is_active
            and not exists (
              select 1 from public.notifications existing
              where existing.recipient_id = m.profile_id
                and existing.kind = 'whatsapp_handoff'
                and existing.whatsapp_conversation_id = v_conv.id
                and existing.read_at is null
            )
          on conflict do nothing;
        end if;
      end if;

      v_messages_count := v_messages_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'statuses_processed', v_statuses_count,
    'messages_processed', v_messages_count,
    'unmapped_ignored', v_unmapped_count,
    'ai_jobs_enqueued', v_jobs_enqueued
  );
end $$;

revoke all on function public.ingest_whatsapp_webhook(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_webhook(jsonb) to service_role;

-- 9. Claim next pending AI job (sequential per conversation via FOR UPDATE SKIP LOCKED)
create or replace function public.claim_whatsapp_ai_job(p_conversation_id uuid default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.whatsapp_ai_jobs%rowtype;
  v_conv public.whatsapp_conversations%rowtype;
  v_channel public.whatsapp_channels%rowtype;
  v_agent public.agents%rowtype;
  v_unhandled jsonb;
  v_history jsonb;
begin
  select j.* into v_job
  from public.whatsapp_ai_jobs j
  where j.status = 'pending'
    and (p_conversation_id is null or j.whatsapp_conversation_id = p_conversation_id)
  order by j.created_at asc
  for update of j skip locked
  limit 1;

  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  select * into v_conv from public.whatsapp_conversations where id = v_job.whatsapp_conversation_id for update;
  select * into v_channel from public.whatsapp_channels where id = v_conv.channel_id;
  select * into v_agent from public.agents where id = v_job.agent_id;

  if v_conv.id is null or v_conv.mode <> 'ai' or v_conv.mode_version <> v_job.mode_version
     or not coalesce(v_channel.ai_auto_reply_enabled, false) or not coalesce(v_channel.is_active, false)
     or coalesce(v_agent.elevenlabs_agent_id, '') = '' or v_agent.status <> 'active' then
    update public.whatsapp_ai_jobs
       set status = case when v_conv.mode = 'human' then 'cancelled_by_takeover' else 'skipped' end,
           completed_at = now(),
           updated_at = now()
     where id = v_job.id;
    return jsonb_build_object('claimed', false, 'cancelled', true);
  end if;

  -- Gather unhandled inbound customer messages in chronological order
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at asc, t.id asc), '[]'::jsonb)
    into v_unhandled
  from (
    select m.id, m.wa_message_id, m.message_type, m.body_text, m.media_metadata, m.created_at
    from public.whatsapp_messages m
    where m.whatsapp_conversation_id = v_conv.id
      and m.direction = 'inbound'
      and m.sender_type = 'customer'
      and (
        v_conv.last_ai_processed_msg_at is null
        or m.created_at > v_conv.last_ai_processed_msg_at
        or (m.created_at = v_conv.last_ai_processed_msg_at and m.id <> coalesce(v_conv.last_ai_processed_msg_id, '00000000-0000-0000-0000-000000000000'::uuid))
      )
    order by m.created_at asc, m.id asc
    limit 20
  ) t;

  if jsonb_array_length(v_unhandled) = 0 then
    update public.whatsapp_ai_jobs
       set status = 'skipped',
           completed_at = now(),
           updated_at = now()
     where id = v_job.id;
    return jsonb_build_object('claimed', false, 'skipped', true);
  end if;

  -- Recent conversation turns (includes human agent replies so Resume AI retains full context)
  select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at asc, h.id asc), '[]'::jsonb)
    into v_history
  from (
    select m.id, m.direction, m.sender_type, m.message_type, m.body_text, m.created_at
    from public.whatsapp_messages m
    where m.whatsapp_conversation_id = v_conv.id
      and m.status <> 'failed'
    order by m.created_at desc, m.id desc
    limit 30
  ) h;

  update public.whatsapp_ai_jobs
     set status = 'processing',
         attempts = attempts + 1,
         started_at = coalesce(started_at, now()),
         updated_at = now()
   where id = v_job.id
   returning * into v_job;

  return jsonb_build_object(
    'claimed', true,
    'job', to_jsonb(v_job),
    'conversation', to_jsonb(v_conv),
    'channel', to_jsonb(v_channel),
    'elevenlabs_agent_id', v_agent.elevenlabs_agent_id,
    'unhandled_messages', v_unhandled,
    'history', v_history
  );
end $$;

revoke all on function public.claim_whatsapp_ai_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_ai_job(uuid) to service_role;

-- 10. Anti-race outbound reservation for AI replies (re-checks mode + mode_version + job status under FOR UPDATE)
create or replace function public.reserve_whatsapp_ai_outbound(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_job_id uuid;
  v_conv_id uuid;
  v_expected_mode_version integer;
  v_cutoff_at timestamptz;
  v_last_msg_id uuid;
  v_body_text text;
  v_idem_key text;
  v_payload_hash text;
  v_el_conv_id text;
  v_metadata jsonb;
  v_job public.whatsapp_ai_jobs%rowtype;
  v_conv public.whatsapp_conversations%rowtype;
  v_channel public.whatsapp_channels%rowtype;
  v_reserved public.whatsapp_messages%rowtype;
  v_has_more boolean := false;
begin
  v_job_id := (payload->>'job_id')::uuid;
  v_conv_id := (payload->>'whatsapp_conversation_id')::uuid;
  v_expected_mode_version := (payload->>'expected_mode_version')::integer;
  v_cutoff_at := (payload->>'processed_until_at')::timestamptz;
  v_last_msg_id := (payload->>'processed_last_msg_id')::uuid;
  v_body_text := left(btrim(coalesce(payload->>'body_text', '')), 4096);
  v_idem_key := btrim(coalesce(payload->>'idempotency_key', ''));
  v_payload_hash := lower(btrim(coalesce(payload->>'payload_hash', '')));
  v_el_conv_id := left(btrim(coalesce(payload->>'elevenlabs_conversation_id', '')), 128);
  v_metadata := coalesce(payload->'metadata', '{}'::jsonb);

  if v_body_text = '' or v_idem_key = '' or char_length(v_payload_hash) <> 64 then
    raise exception 'Invalid AI outbound reservation payload' using errcode = '22023';
  end if;

  select * into v_conv from public.whatsapp_conversations where id = v_conv_id for update;
  select * into v_job from public.whatsapp_ai_jobs where id = v_job_id for update;
  select * into v_channel from public.whatsapp_channels where id = v_conv.channel_id;

  if v_conv.id is null or v_job.id is null or v_conv.mode <> 'ai' or v_conv.mode_version <> v_expected_mode_version
     or v_job.status <> 'processing' or not coalesce(v_channel.ai_auto_reply_enabled, false) then
    if v_job.id is not null and v_job.status in ('pending', 'processing') then
      update public.whatsapp_ai_jobs
         set status = 'cancelled_by_takeover',
             completed_at = now(),
             updated_at = now()
       where id = v_job.id;
    end if;
    return jsonb_build_object(
      'action', 'aborted_by_takeover',
      'current_mode', coalesce(v_conv.mode, 'human'),
      'current_mode_version', coalesce(v_conv.mode_version, 0)
    );
  end if;

  -- Check 24h Meta Customer Service Window before queueing free-form AI text reply
  if v_conv.last_inbound_at is null or now() - v_conv.last_inbound_at >= interval '24 hours' then
    update public.whatsapp_ai_jobs
       set status = 'failed',
           error_message = 'Outside 24h customer service window',
           completed_at = now(),
           updated_at = now()
     where id = v_job.id;
    return jsonb_build_object('action', 'outside_window');
  end if;

  insert into public.whatsapp_messages (
    whatsapp_conversation_id, scope, organization_id, phone_number_id, waba_id,
    direction, sender_type, wa_message_id, peer_wa_id, peer_name,
    message_type, body_text, status, idempotency_key, payload_hash, ai_job_id, metadata
  ) values (
    v_conv.id, v_conv.scope, v_conv.organization_id, v_conv.phone_number_id, v_channel.waba_id,
    'outbound', 'ai', '', v_conv.customer_wa_id, v_conv.customer_name,
    'text', v_body_text, 'queued', v_idem_key, v_payload_hash, v_job.id, v_metadata
  )
  on conflict (organization_id, phone_number_id, idempotency_key) where scope = 'merchant' and idempotency_key <> '' do nothing
  returning * into v_reserved;

  if v_reserved.id is null then
    update public.whatsapp_ai_jobs set status = 'completed', completed_at = now(), updated_at = now() where id = v_job.id;
    return jsonb_build_object('action', 'duplicate');
  end if;

  update public.whatsapp_conversations
     set last_ai_processed_msg_at = greatest(coalesce(last_ai_processed_msg_at, '-infinity'::timestamptz), v_cutoff_at),
         last_ai_processed_msg_id = v_last_msg_id,
         elevenlabs_conversation_id = coalesce(nullif(v_el_conv_id, ''), elevenlabs_conversation_id),
         last_message_preview = left(v_body_text, 300),
         last_message_sender = 'ai',
         last_message_at = now(),
         updated_at = now()
   where id = v_conv.id;

  update public.whatsapp_ai_jobs
     set status = 'completed',
         completed_at = now(),
         updated_at = now()
   where id = v_job.id;

  select exists (
    select 1 from public.whatsapp_messages m
    where m.whatsapp_conversation_id = v_conv.id
      and m.direction = 'inbound'
      and m.sender_type = 'customer'
      and (m.created_at > v_cutoff_at or (m.created_at = v_cutoff_at and m.id <> v_last_msg_id))
  ) into v_has_more;

  if v_has_more then
    insert into public.whatsapp_ai_jobs (
      organization_id, whatsapp_conversation_id, agent_id, mode_version, status
    ) values (
      v_conv.organization_id, v_conv.id, v_job.agent_id, v_conv.mode_version, 'pending'
    )
    on conflict (whatsapp_conversation_id) where status in ('pending', 'processing') do nothing;
  end if;

  return jsonb_build_object(
    'action', 'reserved',
    'record', to_jsonb(v_reserved),
    'has_more_inbound', v_has_more
  );
end $$;

revoke all on function public.reserve_whatsapp_ai_outbound(jsonb) from public, anon, authenticated;
grant execute on function public.reserve_whatsapp_ai_outbound(jsonb) to service_role;

create or replace function public.complete_whatsapp_ai_job_failure(p_job_id uuid, p_status text, p_error text default '') returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_status not in ('failed', 'cancelled_by_takeover', 'skipped') then
    raise exception 'Invalid job completion status' using errcode = '22023';
  end if;
  update public.whatsapp_ai_jobs
     set status = p_status,
         error_message = left(coalesce(p_error, ''), 1000),
         completed_at = now(),
         updated_at = now()
   where id = p_job_id
     and status in ('pending', 'processing');
end $$;

revoke all on function public.complete_whatsapp_ai_job_failure(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_whatsapp_ai_job_failure(uuid, text, text) to service_role;

-- 11. Human outbound reservation (RBAC + 24h Window check for free-form text + idempotency)
create or replace function public.reserve_whatsapp_human_outbound(actor_id uuid, tenant_id uuid, payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_conv_id uuid;
  v_msg_type text;
  v_body_text text;
  v_tpl_name text;
  v_idem_key text;
  v_payload_hash text;
  v_conv public.whatsapp_conversations%rowtype;
  v_channel public.whatsapp_channels%rowtype;
  v_existing public.whatsapp_messages%rowtype;
  v_reserved public.whatsapp_messages%rowtype;
begin
  if actor_id is null or tenant_id is null or not exists (
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

  v_conv_id := (payload->>'whatsapp_conversation_id')::uuid;
  v_msg_type := btrim(coalesce(payload->>'message_type', 'text'));
  v_body_text := left(btrim(coalesce(payload->>'body_text', '')), 4096);
  v_tpl_name := left(btrim(coalesce(payload->>'template_name', '')), 128);
  v_idem_key := btrim(coalesce(payload->>'idempotency_key', ''));
  v_payload_hash := lower(btrim(coalesce(payload->>'payload_hash', '')));

  if v_idem_key = '' or char_length(v_payload_hash) <> 64 or v_msg_type not in ('text', 'template') then
    raise exception 'Invalid human outbound payload' using errcode = '22023';
  end if;

  select * into v_conv
  from public.whatsapp_conversations
  where id = v_conv_id
    and scope = 'merchant'
    and organization_id = tenant_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Conversation unavailable';
  end if;

  select * into v_channel from public.whatsapp_channels where id = v_conv.channel_id and is_active;
  if not found then
    return jsonb_build_object('action', 'unmapped_channel');
  end if;

  if v_msg_type = 'text' and (v_conv.last_inbound_at is null or now() - v_conv.last_inbound_at >= interval '24 hours') then
    return jsonb_build_object(
      'action', 'window_expired',
      'last_inbound_at', v_conv.last_inbound_at
    );
  end if;

  perform pg_advisory_xact_lock(hashtext('wa_hum:' || tenant_id::text || ':' || v_conv.phone_number_id || ':' || v_idem_key));

  select * into v_existing
  from public.whatsapp_messages
  where scope = 'merchant'
    and organization_id = tenant_id
    and phone_number_id = v_conv.phone_number_id
    and idempotency_key = v_idem_key
  for update;

  if found then
    if v_existing.payload_hash <> '' and v_existing.payload_hash <> v_payload_hash then
      return jsonb_build_object('action', 'conflict');
    end if;
    if v_existing.status in ('sent', 'delivered', 'read') then
      return jsonb_build_object('action', 'replay', 'record', to_jsonb(v_existing), 'channel', to_jsonb(v_channel), 'conversation', to_jsonb(v_conv));
    end if;
    if v_existing.status = 'failed' then
      return jsonb_build_object('action', 'previous_failed', 'record', to_jsonb(v_existing));
    end if;
    return jsonb_build_object('action', 'in_flight', 'record', to_jsonb(v_existing));
  end if;

  insert into public.whatsapp_messages (
    whatsapp_conversation_id, scope, organization_id, phone_number_id, waba_id,
    direction, sender_type, sender_actor_id, wa_message_id, peer_wa_id, peer_name,
    message_type, template_name, body_text, status, idempotency_key, payload_hash,
    metadata
  ) values (
    v_conv.id, 'merchant', tenant_id, v_conv.phone_number_id, v_channel.waba_id,
    'outbound', 'human', actor_id, '', v_conv.customer_wa_id, v_conv.customer_name,
    v_msg_type, v_tpl_name, v_body_text, 'queued', v_idem_key, v_payload_hash,
    coalesce(payload->'metadata', '{}'::jsonb)
  )
  returning * into v_reserved;

  update public.whatsapp_conversations
     set last_message_preview = left(coalesce(nullif(v_body_text, ''), '[範本訊息] ' || v_tpl_name), 300),
         last_message_sender = 'human',
         last_message_at = now(),
         unread_count = 0,
         status = case when status = 'resolved' then 'open' else status end,
         updated_at = now()
   where id = v_conv.id;

  return jsonb_build_object(
    'action', 'reserved',
    'record', to_jsonb(v_reserved),
    'channel', to_jsonb(v_channel),
    'conversation', to_jsonb(v_conv)
  );
end $$;

revoke all on function public.reserve_whatsapp_human_outbound(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_whatsapp_human_outbound(uuid, uuid, jsonb) to service_role;

-- 12. Update finalize_whatsapp_outbound to audit irreversible in-flight AI sends after Take Over + alert on failure
create or replace function public.finalize_whatsapp_outbound(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_phone_number_id text;
  v_idem_key text;
  v_status text;
  v_wamid text;
  v_err_code text;
  v_err_title text;
  v_err_msg text;
  v_metadata jsonb;
  v_row public.whatsapp_messages%rowtype;
  v_orphan public.whatsapp_messages%rowtype;
  v_conv public.whatsapp_conversations%rowtype;
  v_orphan_found boolean := false;
  v_effective_status text;
  v_best_rank integer;
  v_row_rank integer;
  v_orphan_rank integer := 0;
  v_req_rank integer;
  v_dispatched_before_takeover boolean := false;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Invalid payload';
  end if;

  if coalesce(btrim(payload->>'id'), '') <> '' then
    v_id := (payload->>'id')::uuid;
  end if;
  v_phone_number_id := btrim(coalesce(payload->>'phone_number_id', ''));
  v_idem_key := btrim(coalesce(payload->>'idempotency_key', ''));
  v_status := btrim(coalesce(payload->>'status', ''));
  v_wamid := btrim(coalesce(payload->>'wa_message_id', ''));
  v_err_code := left(btrim(coalesce(payload->>'error_code', '')), 64);
  v_err_title := left(btrim(coalesce(payload->>'error_title', '')), 200);
  v_err_msg := left(btrim(coalesce(payload->>'error_message', '')), 1000);
  v_metadata := coalesce(payload->'metadata', '{}'::jsonb);

  if v_status not in ('sent', 'failed') then
    raise exception 'Invalid finalize status' using errcode = '22023';
  end if;

  if v_id is not null then
    select * into v_row from public.whatsapp_messages where id = v_id for update;
  elsif v_phone_number_id ~ '^[0-9]{5,32}$' and v_idem_key <> '' then
    select * into v_row
    from public.whatsapp_messages
    where scope = 'admin'
      and phone_number_id = v_phone_number_id
      and idempotency_key = v_idem_key
    for update;
  else
    raise exception 'Missing outbound reservation identifier' using errcode = '22023';
  end if;

  if not found then
    raise exception 'Reserved outbound message not found' using errcode = 'P0002';
  end if;

  if v_wamid <> '' then
    perform pg_advisory_xact_lock(hashtext('wa_wamid:' || v_row.phone_number_id || ':' || v_wamid));

    select * into v_orphan
    from public.whatsapp_messages
    where phone_number_id = v_row.phone_number_id
      and wa_message_id = v_wamid
      and id <> v_row.id
    for update;

    if found then
      if v_orphan.direction <> v_row.direction
         or (v_orphan.idempotency_key <> '' and v_orphan.idempotency_key <> v_row.idempotency_key) then
        raise exception 'WhatsApp message ID already bound to another send' using errcode = '23505';
      end if;
      v_orphan_found := true;
      update public.whatsapp_status_events
         set whatsapp_message_id = v_row.id
       where whatsapp_message_id = v_orphan.id;
      delete from public.whatsapp_messages where id = v_orphan.id;
    end if;
  end if;

  if v_row.whatsapp_conversation_id is not null and v_row.sender_type = 'ai' and v_status = 'sent' then
    select * into v_conv from public.whatsapp_conversations where id = v_row.whatsapp_conversation_id;
    if found and v_conv.mode = 'human' then
      v_dispatched_before_takeover := true;
    end if;
  end if;

  v_req_rank := case v_status when 'sent' then 20 when 'failed' then 50 else 0 end;
  v_row_rank := case v_row.status when 'queued' then 10 when 'sent' then 20 when 'delivered' then 30 when 'read' then 40 when 'failed' then 50 else 0 end;
  if v_orphan_found then
    v_orphan_rank := case v_orphan.status when 'queued' then 10 when 'sent' then 20 when 'delivered' then 30 when 'read' then 40 when 'failed' then 50 else 0 end;
  end if;

  v_best_rank := greatest(v_req_rank, v_row_rank, v_orphan_rank);
  v_effective_status := case
    when v_orphan_found and v_orphan_rank = v_best_rank then v_orphan.status
    when v_row_rank = v_best_rank then v_row.status
    else v_status
  end;

  update public.whatsapp_messages
     set wa_message_id = case when v_wamid <> '' then v_wamid else wa_message_id end,
         status = v_effective_status,
         dispatched_before_takeover = dispatched_before_takeover or v_dispatched_before_takeover,
         error_code = coalesce(nullif(v_err_code, ''), case when v_orphan_found then nullif(v_orphan.error_code, '') end, error_code),
         error_title = coalesce(nullif(v_err_title, ''), case when v_orphan_found then nullif(v_orphan.error_title, '') end, error_title),
         error_message = coalesce(nullif(v_err_msg, ''), case when v_orphan_found then nullif(v_orphan.error_message, '') end, error_message),
         metadata = coalesce(case when v_orphan_found then v_orphan.metadata else null end, '{}'::jsonb) || coalesce(metadata, '{}'::jsonb) || v_metadata,
         sent_at = coalesce(sent_at, case when v_orphan_found then v_orphan.sent_at end, case when v_status = 'sent' then now() end),
         delivered_at = coalesce(delivered_at, case when v_orphan_found then v_orphan.delivered_at end),
         read_at = coalesce(read_at, case when v_orphan_found then v_orphan.read_at end),
         failed_at = coalesce(failed_at, case when v_orphan_found then v_orphan.failed_at end, case when v_status = 'failed' then now() end),
         updated_at = now()
   where id = v_row.id
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

  if v_dispatched_before_takeover then
    insert into public.whatsapp_takeover_events (
      whatsapp_conversation_id, scope, organization_id, action, actor_label,
      previous_mode, next_mode, note
    ) values (
      v_row.whatsapp_conversation_id, v_row.scope, v_row.organization_id,
      'dispatched_before_takeover', '系統對帳', 'ai', 'human',
      '此 AI 回覆在真人按下接管前已送達 Meta；接管已即時生效，後續訊息不會再觸發 AI。'
    );
  end if;

  if v_status = 'failed' and v_row.whatsapp_conversation_id is not null and v_row.organization_id is not null then
    insert into public.notifications (
      recipient_id, kind, whatsapp_conversation_id, organization_id, title, event_key
    )
    select m.profile_id, 'whatsapp_handoff', v_row.whatsapp_conversation_id, v_row.organization_id,
           format('WhatsApp 訊息發送失敗（%s）', coalesce(nullif(v_err_code, ''), 'SEND_ERR')),
           'wa_send_fail:' || v_row.id::text
    from public.organization_members m
    where m.organization_id = v_row.organization_id and m.is_active
    on conflict do nothing;
  end if;

  return to_jsonb(v_row);
end $$;

revoke all on function public.finalize_whatsapp_outbound(jsonb) from public, anon, authenticated;
grant execute on function public.finalize_whatsapp_outbound(jsonb) to service_role;

-- 13. Takeover / Resume AI / Status command RPC (tenant customer_admin only)
create or replace function public.whatsapp_conversation_command(
  actor_id uuid,
  tenant_id uuid,
  operation text,
  payload jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_actor_label text;
  v_conv public.whatsapp_conversations%rowtype;
  v_conv_id uuid;
  v_prev_mode text;
  v_in_flight_meta boolean := false;
  v_latest_inbound_at timestamptz;
  v_latest_inbound_id uuid;
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

  v_conv_id := (payload->>'conversation_id')::uuid;

  select * into v_conv
  from public.whatsapp_conversations
  where id = v_conv_id
    and scope = 'merchant'
    and organization_id = tenant_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Conversation unavailable';
  end if;

  v_prev_mode := v_conv.mode;

  if operation = 'take_over' then
    update public.whatsapp_ai_jobs
       set status = 'cancelled_by_takeover',
           completed_at = now(),
           updated_at = now()
     where whatsapp_conversation_id = v_conv.id
       and status in ('pending', 'processing');

    select exists (
      select 1 from public.whatsapp_messages m
      where m.whatsapp_conversation_id = v_conv.id
        and m.sender_type = 'ai'
        and m.status = 'queued'
    ) into v_in_flight_meta;

    update public.whatsapp_conversations
       set mode = 'human',
           mode_version = mode_version + 1,
           status = case when status = 'resolved' then 'open' else status end,
           assigned_profile_id = actor_id,
           unread_count = 0,
           updated_at = now()
     where id = v_conv.id
     returning * into v_conv;

    insert into public.whatsapp_takeover_events (
      whatsapp_conversation_id, scope, organization_id, action, actor_id, actor_label, previous_mode, next_mode, note
    ) values (
      v_conv.id, 'merchant', tenant_id, 'take_over', actor_id, v_actor_label, v_prev_mode, 'human',
      case when v_in_flight_meta then '接管時有一則已發往 Meta 的 AI 回覆正在傳送中' else '' end
    );
  elsif operation = 'resume_ai' then
    -- Advance AI cursor past all customer messages received before Resume AI so AI never replies twice to old messages
    select m.created_at, m.id
      into v_latest_inbound_at, v_latest_inbound_id
    from public.whatsapp_messages m
    where m.whatsapp_conversation_id = v_conv.id
      and m.direction = 'inbound'
    order by m.created_at desc, m.id desc
    limit 1;

    update public.whatsapp_conversations
       set mode = 'ai',
           mode_version = mode_version + 1,
           status = 'open',
           needs_human_reason = '',
           last_ai_processed_msg_at = greatest(coalesce(last_ai_processed_msg_at, '-infinity'::timestamptz), coalesce(v_latest_inbound_at, now())),
           last_ai_processed_msg_id = coalesce(v_latest_inbound_id, last_ai_processed_msg_id),
           updated_at = now()
     where id = v_conv.id
     returning * into v_conv;

    insert into public.whatsapp_takeover_events (
      whatsapp_conversation_id, scope, organization_id, action, actor_id, actor_label, previous_mode, next_mode
    ) values (
      v_conv.id, 'merchant', tenant_id, 'resume_ai', actor_id, v_actor_label, v_prev_mode, 'ai'
    );
  elsif operation = 'mark_resolved' then
    update public.whatsapp_ai_jobs
       set status = 'cancelled_by_takeover',
           completed_at = now(),
           updated_at = now()
     where whatsapp_conversation_id = v_conv.id
       and status in ('pending', 'processing');

    update public.whatsapp_conversations
       set status = 'resolved',
           unread_count = 0,
           updated_at = now()
     where id = v_conv.id
     returning * into v_conv;

    insert into public.whatsapp_takeover_events (
      whatsapp_conversation_id, scope, organization_id, action, actor_id, actor_label, previous_mode, next_mode
    ) values (
      v_conv.id, 'merchant', tenant_id, 'mark_resolved', actor_id, v_actor_label, v_prev_mode, v_conv.mode
    );
  elsif operation = 'reopen' then
    update public.whatsapp_conversations
       set status = case when mode = 'human' then 'needs_human' else 'open' end,
           updated_at = now()
     where id = v_conv.id
     returning * into v_conv;

    insert into public.whatsapp_takeover_events (
      whatsapp_conversation_id, scope, organization_id, action, actor_id, actor_label, previous_mode, next_mode
    ) values (
      v_conv.id, 'merchant', tenant_id, 'reopen', actor_id, v_actor_label, v_prev_mode, v_conv.mode
    );
  elsif operation = 'mark_read' then
    update public.whatsapp_conversations
       set unread_count = 0,
           updated_at = now()
     where id = v_conv.id
     returning * into v_conv;
  elsif operation = 'mark_unread' then
    update public.whatsapp_conversations
       set unread_count = greatest(unread_count, 1),
           updated_at = now()
     where id = v_conv.id
     returning * into v_conv;

    insert into public.whatsapp_takeover_events (
      whatsapp_conversation_id, scope, organization_id, action, actor_id, actor_label, previous_mode, next_mode
    ) values (
      v_conv.id, 'merchant', tenant_id, 'mark_unread', actor_id, v_actor_label, v_prev_mode, v_conv.mode
    );
  else
    raise exception 'Unsupported WhatsApp conversation command' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'ok', true,
    'conversation', to_jsonb(v_conv),
    'in_flight_ai_dispatch', v_in_flight_meta
  );
end $$;

revoke all on function public.whatsapp_conversation_command(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_conversation_command(uuid, uuid, text, jsonb) to service_role;

-- 14. AI tool escalation RPC (called via verified agent_token credential)
create or replace function public.whatsapp_handoff_escalation(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_token_hash text;
  v_claimed_agent_id text;
  v_conv_id uuid;
  v_customer_wa_id text;
  v_el_conv_id text;
  v_reason text;
  v_switch_to_human boolean;
  v_org uuid;
  v_agent_id uuid;
  v_provider_agent_id text;
  v_conv public.whatsapp_conversations%rowtype;
begin
  v_token_hash := lower(btrim(coalesce(payload->>'credential_token_hash', '')));
  v_claimed_agent_id := btrim(coalesce(payload->>'claimed_provider_agent_id', ''));
  v_reason := left(btrim(coalesce(payload->>'reason', '顧客要求真人客服協助')), 500);
  v_switch_to_human := coalesce((payload->>'switch_to_human')::boolean, true);
  v_customer_wa_id := regexp_replace(coalesce(payload->>'customer_wa_id', ''), '[^0-9]', '', 'g');
  v_el_conv_id := btrim(coalesce(payload->>'elevenlabs_conversation_id', ''));
  if coalesce(btrim(payload->>'whatsapp_conversation_id'), '') <> '' then
    v_conv_id := (payload->>'whatsapp_conversation_id')::uuid;
  end if;

  if char_length(v_token_hash) <> 64 then
    return jsonb_build_object('ok', false, 'error_code', 'unauthorized');
  end if;

  select a.id, a.organization_id, a.elevenlabs_agent_id
    into v_agent_id, v_org, v_provider_agent_id
  from public.agent_tool_credentials c
  join public.agents a on a.id = c.agent_id and a.organization_id = c.organization_id
  join public.organizations o on o.id = c.organization_id
  where c.secret_hash = v_token_hash
    and c.tool_name = 'create_message'
    and c.is_active
    and a.status = 'active'
    and o.status = 'active'
  limit 1;

  if v_agent_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'unauthorized');
  end if;
  if v_claimed_agent_id <> '' and v_claimed_agent_id <> v_provider_agent_id then
    return jsonb_build_object('ok', false, 'error_code', 'agent_mismatch');
  end if;

  if v_conv_id is not null then
    select * into v_conv from public.whatsapp_conversations
    where id = v_conv_id and organization_id = v_org and scope = 'merchant' for update;
  elsif v_customer_wa_id ~ '^[0-9]{6,20}$' then
    select * into v_conv from public.whatsapp_conversations
    where organization_id = v_org and scope = 'merchant' and customer_wa_id = v_customer_wa_id
    order by last_message_at desc limit 1 for update;
  elsif v_el_conv_id <> '' then
    select * into v_conv from public.whatsapp_conversations
    where organization_id = v_org and scope = 'merchant' and elevenlabs_conversation_id = v_el_conv_id
    order by last_message_at desc limit 1 for update;
  end if;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'conversation_not_found');
  end if;

  if v_switch_to_human then
    update public.whatsapp_ai_jobs
       set status = 'cancelled_by_takeover', completed_at = now(), updated_at = now()
     where whatsapp_conversation_id = v_conv.id and status in ('pending', 'processing');
  end if;

  update public.whatsapp_conversations
     set status = 'needs_human',
         mode = case when v_switch_to_human then 'human' else mode end,
         mode_version = case when v_switch_to_human and mode <> 'human' then mode_version + 1 else mode_version end,
         needs_human_reason = v_reason,
         updated_at = now()
   where id = v_conv.id
   returning * into v_conv;

  insert into public.whatsapp_takeover_events (
    whatsapp_conversation_id, scope, organization_id, action, actor_label, previous_mode, next_mode, note
  ) values (
    v_conv.id, 'merchant', v_org, 'ai_escalated', 'AI 專員',
    case when v_switch_to_human then 'ai' else v_conv.mode end, v_conv.mode, v_reason
  );

  insert into public.notifications (
    recipient_id, kind, whatsapp_conversation_id, organization_id, title, event_key
  )
  select m.profile_id, 'whatsapp_handoff', v_conv.id, v_org,
         format('需要真人跟進 WhatsApp：%s（%s）', coalesce(nullif(v_conv.customer_name, ''), '+' || v_conv.customer_wa_id), left(v_reason, 60)),
         'wa_escalate:' || v_conv.id::text || ':' || v_conv.mode_version::text
  from public.organization_members m
  where m.organization_id = v_org and m.is_active
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'conversation', to_jsonb(v_conv));
end $$;

revoke all on function public.whatsapp_handoff_escalation(jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_handoff_escalation(jsonb) to service_role;

commit;
