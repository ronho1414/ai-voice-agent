-- ==============================================================================
-- Orai Service — Coordinated Zero-Downtime Agent Tool Credential Rotation
-- Migration: 20261127060000_staged_credential_rotation.sql
-- Description:
--   Allows up to 2 concurrently active create_message credentials for a single
--   agent during coordinated rotation (stage new -> verify live -> revoke old),
--   while preserving global secret_hash uniqueness and per-agent binding.
-- ==============================================================================

begin;

drop index if exists public.agent_tool_credentials_active_agent_uq;

create index if not exists agent_tool_credentials_active_agent_idx
  on public.agent_tool_credentials (agent_id, tool_name)
  where is_active;

create or replace function public.stage_agent_tool_credential(
  p_agent_id uuid,
  p_secret_hash text,
  p_secret_prefix text default ''
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_org_id uuid;
  v_active_count integer := 0;
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

  select count(*)::integer into v_active_count
  from public.agent_tool_credentials c
  where c.agent_id = p_agent_id
    and c.tool_name = 'create_message'
    and c.is_active;

  if v_active_count >= 2 then
    raise exception 'Maximum overlapping active credentials (2) reached; revoke previous credential first' using errcode = '23514';
  end if;

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

revoke all on function public.stage_agent_tool_credential(uuid, text, text) from public, anon, authenticated;
grant execute on function public.stage_agent_tool_credential(uuid, text, text) to service_role;

create or replace function public.revoke_agent_tool_credential(
  p_agent_id uuid,
  p_keep_credential_id uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_revoked_count integer := 0;
begin
  if p_agent_id is null or p_keep_credential_id is null then
    raise exception 'Invalid credential revocation parameters' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.agent_tool_credentials c
    where c.id = p_keep_credential_id
      and c.agent_id = p_agent_id
      and c.tool_name = 'create_message'
      and c.is_active
  ) then
    raise exception 'Replacement active credential not found; refusing to lock out agent' using errcode = 'P0002';
  end if;

  update public.agent_tool_credentials
     set is_active = false,
         revoked_at = coalesce(revoked_at, now())
   where agent_id = p_agent_id
     and tool_name = 'create_message'
     and id <> p_keep_credential_id
     and is_active;
  get diagnostics v_revoked_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'agent_id', p_agent_id,
    'kept_credential_id', p_keep_credential_id,
    'revoked_count', v_revoked_count
  );
end $$;

revoke all on function public.revoke_agent_tool_credential(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_agent_tool_credential(uuid, uuid) to service_role;

commit;
