-- Restrict customer writes to safe profile and business fields. Admin APIs use
-- the server-only service role; customer JWTs remain constrained by RLS/grants.

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and system_role = 'super_admin'
  );
$$;

create or replace function public.get_user_organization_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select organization_id from public.organization_members
  where profile_id = auth.uid() and is_active = true;
$$;

create or replace function public.is_customer_admin_for(target_org_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where profile_id = auth.uid()
      and organization_id = target_org_id
      and role = 'customer_admin'
      and is_active = true
  );
$$;

drop policy if exists "Customer admin can update their own organization profile"
  on public.organizations;
create policy "Customer admin can update safe organization profile fields"
  on public.organizations for update
  using (public.is_customer_admin_for(id))
  with check (public.is_customer_admin_for(id));

drop policy if exists "Customer members can view members in their organization"
  on public.organization_members;
create policy "Customer admins can view members in their organization"
  on public.organization_members for select
  using (public.is_customer_admin_for(organization_id));

-- A row policy cannot restrict individual columns, so enforce that with grants.
revoke update on public.profiles from authenticated;
grant update (full_name, phone, updated_at) on public.profiles to authenticated;

revoke update on public.organizations from authenticated;
grant update (name, phone, email, address, opening_hours, updated_at)
  on public.organizations to authenticated;
