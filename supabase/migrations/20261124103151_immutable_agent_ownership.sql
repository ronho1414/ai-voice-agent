-- Retain provider IDs as non-reusable tenant ownership tombstones, even after removal.
create table public.elevenlabs_agent_ownership (
  agent_id text primary key check (length(agent_id)>0),
  organization_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.elevenlabs_agent_ownership enable row level security;
revoke all on public.elevenlabs_agent_ownership from public,anon,authenticated,service_role;

-- Fail on historical ambiguity instead of choosing an owner.
do $$ begin
  if exists(select agent_id from (
    select elevenlabs_agent_id agent_id,organization_id from public.agents where elevenlabs_agent_id<>''
    union select provider_agent_id,organization_id from public.conversations where provider='elevenlabs' and provider_agent_id is not null
  ) owners group by agent_id having count(distinct organization_id)>1) then
    raise exception 'Ambiguous historical ElevenLabs agent ownership';
  end if;
end $$;
insert into public.elevenlabs_agent_ownership(agent_id,organization_id)
select elevenlabs_agent_id,organization_id from public.agents where elevenlabs_agent_id<>''
union select provider_agent_id,organization_id from public.conversations where provider='elevenlabs' and provider_agent_id is not null;

create function private.reserve_elevenlabs_agent_owner() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.elevenlabs_agent_id='' then return new; end if;
  insert into public.elevenlabs_agent_ownership(agent_id,organization_id)
    values(new.elevenlabs_agent_id,new.organization_id) on conflict(agent_id) do nothing;
  if not exists(select 1 from public.elevenlabs_agent_ownership
      where agent_id=new.elevenlabs_agent_id and organization_id=new.organization_id) then
    raise exception 'ElevenLabs agent IDs cannot be reassigned across tenants';
  end if;
  return new;
end $$;
revoke all on function private.reserve_elevenlabs_agent_owner() from public,anon,authenticated,service_role;
create trigger reserve_elevenlabs_agent_owner before insert or update on public.agents
for each row execute function private.reserve_elevenlabs_agent_owner();
