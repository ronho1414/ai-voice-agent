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
    return 'ownership_conflict';
  end if;
  return 'synced';
end $$;
revoke all on function public.ingest_elevenlabs_call(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_elevenlabs_call(jsonb) to service_role;

-- Table privileges already exist in auth_tenant_isolation. No extra grants needed.
-- One RPC transaction prevents an agent constraint failure leaving an orphan org.
create function public.create_organization_with_agent(organization_payload jsonb, agent_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare created public.organizations;
begin
  if (agent_payload->>'organization_id')::uuid is distinct from (organization_payload->>'id')::uuid then
    raise exception 'Agent organization mismatch';
  end if;
  insert into public.organizations select (jsonb_populate_record(null::public.organizations, organization_payload)).*
    returning * into created;
  insert into public.agents select (jsonb_populate_record(null::public.agents, agent_payload)).*;
  return to_jsonb(created);
end $$;
revoke all on function public.create_organization_with_agent(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_organization_with_agent(jsonb,jsonb) to service_role;
