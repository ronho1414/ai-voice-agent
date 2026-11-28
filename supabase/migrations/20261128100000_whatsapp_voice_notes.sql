-- WhatsApp voice notes on the existing text Master Router.
-- Additive: per-channel reply preference, private audio bytes, transcript idempotency,
-- and a second takeover check immediately before an AI audio send.
-- The text-only ConvAI WebSocket is unchanged.

begin;

alter table public.whatsapp_channels
  add column if not exists reply_preference text not null default 'auto'
  check (reply_preference in ('auto', 'text', 'voice'));

create table if not exists private.whatsapp_voice_media (
  message_id uuid primary key references public.whatsapp_messages(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  content_type text not null default 'audio/ogg' check (char_length(content_type) <= 128),
  byte_size integer not null check (byte_size > 0 and byte_size <= 8388608),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  audio bytea not null,
  created_at timestamptz not null default now(),
  retain_until timestamptz not null default (now() + interval '30 days'),
  constraint whatsapp_voice_media_size_ck check (octet_length(audio) = byte_size)
);

alter table private.whatsapp_voice_media enable row level security;
revoke all on table private.whatsapp_voice_media from public, anon, authenticated;
grant all on table private.whatsapp_voice_media to service_role;

create index if not exists whatsapp_voice_media_retain_idx
  on private.whatsapp_voice_media (retain_until);

create or replace function public.record_whatsapp_voice_transcript(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_org uuid;
  v_text text;
  v_lang text;
  v_seconds numeric;
  v_row public.whatsapp_messages%rowtype;
begin
  v_id := (payload->>'message_id')::uuid;
  v_org := (payload->>'organization_id')::uuid;
  v_text := left(btrim(coalesce(payload->>'transcript', '')), 4096);
  v_lang := left(btrim(coalesce(payload->>'language', '')), 16);
  if payload->>'audio_seconds' ~ '^[0-9]+(\.[0-9]+)?$' then
    v_seconds := (payload->>'audio_seconds')::numeric;
  end if;

  if v_text = '' then
    return jsonb_build_object('ok', false, 'error_code', 'empty_transcript');
  end if;

  select * into v_row
  from public.whatsapp_messages
  where id = v_id
    and organization_id = v_org
    and direction = 'inbound'
    and message_type = 'audio'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'not_found');
  end if;

  if coalesce(v_row.media_metadata->'stt'->>'status', '') = 'done' and btrim(v_row.body_text) <> '' then
    return jsonb_build_object('ok', true, 'applied', false, 'transcript', v_row.body_text);
  end if;

  update public.whatsapp_messages
     set body_text = v_text,
         media_metadata = coalesce(media_metadata, '{}'::jsonb) || jsonb_build_object(
           'stt', jsonb_build_object(
             'status', 'done',
             'language', v_lang,
             'audio_seconds', v_seconds
           )
         ),
         updated_at = now()
   where id = v_id;

  update public.whatsapp_conversations
     set last_message_preview = left(v_text, 300),
         updated_at = now()
   where id = v_row.whatsapp_conversation_id;

  return jsonb_build_object('ok', true, 'applied', true, 'transcript', v_text);
end $$;

revoke all on function public.record_whatsapp_voice_transcript(jsonb) from public, anon, authenticated;
grant execute on function public.record_whatsapp_voice_transcript(jsonb) to service_role;

create or replace function public.store_whatsapp_voice_media(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_org uuid;
  v_hash text;
  v_type text;
  v_audio bytea;
  v_existing private.whatsapp_voice_media%rowtype;
  v_message public.whatsapp_messages%rowtype;
begin
  v_id := (payload->>'message_id')::uuid;
  v_org := (payload->>'organization_id')::uuid;
  v_hash := lower(btrim(coalesce(payload->>'sha256', '')));
  v_type := left(btrim(coalesce(payload->>'content_type', 'audio/ogg')), 128);
  if v_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error_code', 'invalid');
  end if;

  select * into v_message
  from public.whatsapp_messages
  where id = v_id and organization_id = v_org
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'not_found');
  end if;

  select * into v_existing from private.whatsapp_voice_media where message_id = v_id;
  if found then
    return jsonb_build_object('ok', true, 'stored', false);
  end if;

  v_audio := decode(coalesce(payload->>'audio_base64', ''), 'base64');
  if v_audio is null or octet_length(v_audio) = 0 or octet_length(v_audio) > 8388608 then
    return jsonb_build_object('ok', false, 'error_code', 'too_large');
  end if;

  insert into private.whatsapp_voice_media (
    message_id, organization_id, content_type, byte_size, sha256, audio
  ) values (
    v_id, v_org, v_type, octet_length(v_audio), v_hash, v_audio
  );

  update public.whatsapp_messages
     set media_metadata = coalesce(media_metadata, '{}'::jsonb) || jsonb_build_object('has_playback', true),
         updated_at = now()
   where id = v_id;

  return jsonb_build_object('ok', true, 'stored', true, 'byte_size', octet_length(v_audio));
exception
  when others then
    return jsonb_build_object('ok', false, 'error_code', 'invalid');
end $$;

revoke all on function public.store_whatsapp_voice_media(jsonb) from public, anon, authenticated;
grant execute on function public.store_whatsapp_voice_media(jsonb) to service_role;

create or replace function public.read_whatsapp_voice_media(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_actor uuid;
  v_tenant uuid;
  v_id uuid;
  v_row private.whatsapp_voice_media%rowtype;
begin
  v_actor := (payload->>'actor_id')::uuid;
  v_tenant := (payload->>'tenant_id')::uuid;
  v_id := (payload->>'message_id')::uuid;

  if v_actor is null or v_tenant is null or not exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.profile_id = v_actor
      and m.organization_id = v_tenant
      and m.is_active
      and o.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'unauthorized');
  end if;

  select * into v_row
  from private.whatsapp_voice_media
  where message_id = v_id
    and organization_id = v_tenant;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'not_found');
  end if;

  if v_row.retain_until < now() then
    delete from private.whatsapp_voice_media where message_id = v_id;
    return jsonb_build_object('ok', false, 'error_code', 'expired');
  end if;

  return jsonb_build_object(
    'ok', true,
    'content_type', v_row.content_type,
    'byte_size', v_row.byte_size,
    'audio_base64', encode(v_row.audio, 'base64')
  );
end $$;

revoke all on function public.read_whatsapp_voice_media(jsonb) from public, anon, authenticated;
grant execute on function public.read_whatsapp_voice_media(jsonb) to service_role;

create or replace function public.purge_expired_whatsapp_voice_media(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_deleted integer;
begin
  delete from private.whatsapp_voice_media where retain_until < now();
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end $$;

revoke all on function public.purge_expired_whatsapp_voice_media(jsonb) from public, anon, authenticated;
grant execute on function public.purge_expired_whatsapp_voice_media(jsonb) to service_role;

create or replace function public.set_whatsapp_reply_preference(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_actor uuid;
  v_tenant uuid;
  v_channel uuid;
  v_pref text;
  v_updated uuid;
begin
  v_actor := (payload->>'actor_id')::uuid;
  v_tenant := (payload->>'tenant_id')::uuid;
  v_channel := (payload->>'channel_id')::uuid;
  v_pref := btrim(coalesce(payload->>'preference', ''));

  if v_pref not in ('auto', 'text', 'voice') then
    return jsonb_build_object('ok', false, 'error_code', 'invalid');
  end if;

  if v_actor is null or v_tenant is null or not exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.profile_id = v_actor
      and m.organization_id = v_tenant
      and m.role = 'customer_admin'
      and m.is_active
      and o.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'unauthorized');
  end if;

  update public.whatsapp_channels
     set reply_preference = v_pref,
         updated_at = now()
   where id = v_channel
     and organization_id = v_tenant
     and scope = 'merchant'
   returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'channel_id', v_updated, 'preference', v_pref);
end $$;

revoke all on function public.set_whatsapp_reply_preference(jsonb) from public, anon, authenticated;
grant execute on function public.set_whatsapp_reply_preference(jsonb) to service_role;

create or replace function public.recheck_whatsapp_ai_send(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_conv_id uuid;
  v_expected integer;
  v_conv public.whatsapp_conversations%rowtype;
begin
  v_conv_id := (payload->>'whatsapp_conversation_id')::uuid;
  v_expected := (payload->>'expected_mode_version')::integer;
  select * into v_conv from public.whatsapp_conversations where id = v_conv_id for update;
  if not found or v_conv.mode <> 'ai' or v_conv.mode_version <> v_expected then
    return jsonb_build_object(
      'ok', false,
      'action', 'aborted_by_takeover',
      'current_mode', coalesce(v_conv.mode, 'human'),
      'current_mode_version', coalesce(v_conv.mode_version, 0)
    );
  end if;
  if v_conv.last_inbound_at is null or now() - v_conv.last_inbound_at >= interval '24 hours' then
    return jsonb_build_object('ok', false, 'action', 'outside_window');
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.recheck_whatsapp_ai_send(jsonb) from public, anon, authenticated;
grant execute on function public.recheck_whatsapp_ai_send(jsonb) to service_role;

create or replace function public.retarget_whatsapp_queued_outbound(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_type text;
  v_media jsonb;
  v_row public.whatsapp_messages%rowtype;
begin
  v_id := (payload->>'id')::uuid;
  v_type := case when payload->>'message_type' = 'audio' then 'audio' else 'text' end;
  v_media := case
    when jsonb_typeof(payload->'media_metadata') = 'object' then payload->'media_metadata'
    else '{}'::jsonb
  end;
  select * into v_row from public.whatsapp_messages where id = v_id and status = 'queued' for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  update public.whatsapp_messages
     set message_type = v_type,
         media_metadata = coalesce(media_metadata, '{}'::jsonb) || v_media,
         updated_at = now()
   where id = v_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.retarget_whatsapp_queued_outbound(jsonb) from public, anon, authenticated;
grant execute on function public.retarget_whatsapp_queued_outbound(jsonb) to service_role;

-- Claim now also returns the agent language so Scribe can choose yue, zh, or en.
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
    'agent_language_mode', coalesce(v_agent.language_mode, ''),
    'unhandled_messages', v_unhandled,
    'history', v_history
  );
end $$;

revoke all on function public.claim_whatsapp_ai_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_ai_job(uuid) to service_role;

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
  v_msg_type text;
  v_media jsonb;
  v_preview text;
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
  v_msg_type := case when btrim(coalesce(payload->>'message_type', 'text')) = 'audio' then 'audio' else 'text' end;
  v_media := case
    when jsonb_typeof(payload->'media_metadata') = 'object' then payload->'media_metadata'
    else '{}'::jsonb
  end;
  v_preview := left(case when v_msg_type = 'audio' then '[語音] ' || v_body_text else v_body_text end, 300);

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
    message_type, body_text, media_metadata, status, idempotency_key, payload_hash, ai_job_id, metadata
  ) values (
    v_conv.id, v_conv.scope, v_conv.organization_id, v_conv.phone_number_id, v_channel.waba_id,
    'outbound', 'ai', '', v_conv.customer_wa_id, v_conv.customer_name,
    v_msg_type, v_body_text, v_media, 'queued', v_idem_key, v_payload_hash, v_job.id, v_metadata
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
         last_message_preview = v_preview,
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

commit;
