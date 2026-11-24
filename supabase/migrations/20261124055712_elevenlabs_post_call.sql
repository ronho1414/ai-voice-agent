-- Existing conversations and RLS are preserved. Refuse ambiguous agent mappings.
create unique index agents_elevenlabs_unique on public.agents(elevenlabs_agent_id) where elevenlabs_agent_id <> '';
alter table public.conversations
  add column provider text,
  add column provider_conversation_id text,
  add column provider_agent_id text,
  add column started_at timestamptz,
  add column ended_at timestamptz,
  add column transcript jsonb not null default '[]'::jsonb,
  add column analysis jsonb not null default '{}'::jsonb;
create unique index conversations_provider_unique on public.conversations(provider, provider_conversation_id);

create function public.ingest_elevenlabs_call(payload jsonb) returns text
language plpgsql security invoker set search_path = '' as $$
declare tenant uuid; existing public.conversations%rowtype;
begin
  select a.organization_id into tenant from public.agents a
    join public.organizations o on o.id=a.organization_id
    where a.elevenlabs_agent_id=payload->>'provider_agent_id' and o.status='active'
    for share of a, o;
  if tenant is null then return 'unknown_agent'; end if;
  insert into public.conversations(organization_id,session_id,provider,provider_conversation_id,provider_agent_id,
    channel,duration_seconds,started_at,ended_at,created_at,transcript,summary,analysis,status)
  values(tenant,payload->>'provider_conversation_id','elevenlabs',payload->>'provider_conversation_id',payload->>'provider_agent_id',
    payload->>'channel',(payload->>'duration_seconds')::integer,(payload->>'started_at')::timestamptz,
    (payload->>'ended_at')::timestamptz,(payload->>'started_at')::timestamptz,payload->'transcript',payload->>'summary',payload->'analysis','completed')
  on conflict(provider,provider_conversation_id) do nothing;
  select * into existing from public.conversations where provider='elevenlabs' and provider_conversation_id=payload->>'provider_conversation_id';
  if existing.organization_id <> tenant or existing.provider_agent_id <> payload->>'provider_agent_id' then
    raise exception 'Conversation ownership conflict';
  end if;
  return 'synced';
end $$;
revoke all on function public.ingest_elevenlabs_call(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_elevenlabs_call(jsonb) to service_role;
grant select,insert on public.conversations to service_role;
grant select on public.agents,public.organizations to service_role;
grant update(id) on public.agents,public.organizations to service_role;
