-- Apply after 001 and 002. No existing customer records are deleted.
-- Old profiles without an Auth user remain inaccessible; reconcile them before
-- validating the NOT VALID foreign key during a separate onboarding migration.
begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter table public.profiles alter column id drop default;
alter table public.profiles add constraint profiles_auth_user_fk
  foreign key (id) references auth.users(id) on delete cascade not valid;

-- Definer helpers are deliberately outside the exposed public schema and
-- inspect only the caller's verified JWT identity. No caller-supplied user ID.
create or replace function private.current_session_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    where s.user_id = auth.uid()
      and s.id::text = (auth.jwt() ->> 'session_id')
      and (s.not_after is null or s.not_after > now())
      and (u.banned_until is null or u.banned_until <= now())
      and not coalesce(u.is_anonymous, false)
  );
$$;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_session_is_active() and exists (
    select 1 from public.profiles where id = auth.uid() and system_role = 'super_admin'
  );
$$;

create or replace function private.get_user_organization_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.organization_id from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where private.current_session_is_active() and m.profile_id = auth.uid()
    and m.is_active and o.status = 'active';
$$;

create or replace function private.is_customer_admin_for(target_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_session_is_active() and exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.profile_id = auth.uid() and m.organization_id = target_org_id
      and m.role = 'customer_admin' and m.is_active and o.status = 'active'
  );
$$;

revoke all on function private.current_session_is_active() from public, anon;
revoke all on function private.is_super_admin() from public, anon;
revoke all on function private.get_user_organization_ids() from public, anon;
revoke all on function private.is_customer_admin_for(uuid) from public, anon;
grant execute on function private.current_session_is_active(), private.is_super_admin(),
  private.get_user_organization_ids(), private.is_customer_admin_for(uuid) to authenticated;

-- Compatibility wrappers are invokers and cannot bypass the private checks.
create or replace function public.current_session_is_active()
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.current_session_is_active();
$$;
create or replace function public.is_super_admin()
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.is_super_admin();
$$;
create or replace function public.get_user_organization_ids()
returns setof uuid language sql stable security invoker set search_path = '' as $$
  select private.get_user_organization_ids();
$$;
create or replace function public.is_customer_admin_for(target_org_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.is_customer_admin_for(target_org_id);
$$;
revoke all on function public.current_session_is_active(), public.is_super_admin(),
  public.get_user_organization_ids(), public.is_customer_admin_for(uuid) from public, anon;
grant execute on function public.current_session_is_active(), public.is_super_admin(),
  public.get_user_organization_ids(), public.is_customer_admin_for(uuid) to authenticated;

-- Replace previous permissive policies and reset both table AND column grants.
do $$
declare target text; policy_row record; columns_sql text;
begin
  foreach target in array array['organizations','profiles','organization_members',
    'agents','knowledge_sources','conversations','appointments','usage_records'] loop
    execute format('alter table public.%I enable row level security', target);
    for policy_row in select policyname from pg_policies
      where schemaname = 'public' and tablename = target loop
      execute format('drop policy %I on public.%I', policy_row.policyname, target);
    end loop;
    execute format('revoke all on public.%I from public, anon, authenticated', target);
    select string_agg(quote_ident(attname), ',') into columns_sql
      from pg_attribute where attrelid = format('public.%I', target)::regclass
        and attnum > 0 and not attisdropped;
    execute format('revoke all (%s) on public.%I from public, anon, authenticated', columns_sql, target);
    execute format('grant select on public.%I to authenticated', target);
    execute format('grant all on public.%I to service_role', target);
  end loop;
end;
$$;

-- Profiles and memberships are provisioned only through trusted administration.
-- Clients cannot insert/delete their profile or write roles, IDs or memberships.
grant update (full_name, phone, updated_at) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (private.is_super_admin() or (id = auth.uid() and private.current_session_is_active()));
create policy profiles_update_safe on public.profiles for update to authenticated
  using (id = auth.uid() and private.current_session_is_active())
  with check (id = auth.uid() and private.current_session_is_active());

create policy members_read on public.organization_members for select to authenticated
  using (private.is_super_admin() or (private.current_session_is_active() and profile_id = auth.uid())
    or private.is_customer_admin_for(organization_id));

grant update (name, phone, email, address, opening_hours, updated_at)
  on public.organizations to authenticated;
create policy organizations_read on public.organizations for select to authenticated
  using (private.is_super_admin() or id in (select private.get_user_organization_ids()));
create policy organizations_update_safe on public.organizations for update to authenticated
  using (private.is_super_admin() or private.is_customer_admin_for(id))
  with check (private.is_super_admin() or private.is_customer_admin_for(id));

create policy agents_read on public.agents for select to authenticated
  using (private.is_super_admin() or organization_id in (select private.get_user_organization_ids()));
create policy conversations_read on public.conversations for select to authenticated
  using (private.is_super_admin() or organization_id in (select private.get_user_organization_ids()));
create policy usage_read on public.usage_records for select to authenticated
  using (private.is_super_admin() or organization_id in (select private.get_user_organization_ids()));

grant insert (organization_id,title,source_type,content,file_size,is_active)
  on public.knowledge_sources to authenticated;
grant update (title,source_type,content,file_size,is_active,updated_at)
  on public.knowledge_sources to authenticated;
grant delete on public.knowledge_sources to authenticated;
create policy knowledge_read on public.knowledge_sources for select to authenticated
  using (private.is_super_admin() or organization_id in (select private.get_user_organization_ids()));
create policy knowledge_insert on public.knowledge_sources for insert to authenticated
  with check (private.is_super_admin() or private.is_customer_admin_for(organization_id));
create policy knowledge_update on public.knowledge_sources for update to authenticated
  using (private.is_super_admin() or private.is_customer_admin_for(organization_id))
  with check (private.is_super_admin() or private.is_customer_admin_for(organization_id));
create policy knowledge_delete on public.knowledge_sources for delete to authenticated
  using (private.is_super_admin() or private.is_customer_admin_for(organization_id));

grant update (status, updated_at) on public.appointments to authenticated;
create policy appointments_read on public.appointments for select to authenticated
  using (private.is_super_admin() or organization_id in (select private.get_user_organization_ids()));
create policy appointments_update on public.appointments for update to authenticated
  using (private.is_super_admin() or private.is_customer_admin_for(organization_id))
  with check (private.is_super_admin() or private.is_customer_admin_for(organization_id));

-- Database-level same-tenant integrity for existing and future request writes.
alter table public.conversations add constraint conversations_org_id_unique unique (organization_id, id);
alter table public.appointments add constraint appointments_conversation_tenant_fk
  foreign key (organization_id, conversation_id)
  references public.conversations(organization_id, id) not valid;

commit;
