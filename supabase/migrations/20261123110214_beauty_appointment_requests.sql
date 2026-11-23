begin;
alter table public.appointments add column request_key uuid;
alter table public.appointments add column request_hash text check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$');
alter table public.appointments add column preferred_time_window text
  check (preferred_time_window is null or preferred_time_window in ('morning','afternoon','evening'));
alter table public.appointments add column source text not null default 'admin'
  check (source in ('admin','beauty_website','voice'));
alter table public.appointments add constraint appointments_tenant_request_key unique (organization_id, request_key);
alter table public.appointments drop constraint appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status in ('pending','confirmed','rejected','cancelled','completed'));
create or replace function private.enforce_appointment_transition()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status is distinct from old.status and not (
    (old.status = 'pending' and new.status in ('confirmed','rejected','cancelled')) or
    (old.status = 'confirmed' and new.status in ('completed','cancelled'))
  ) then raise exception 'Invalid appointment status transition' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_appointment_transition() from public, anon, authenticated;
create trigger enforce_appointment_transition before update of status on public.appointments
  for each row execute function private.enforce_appointment_transition();
-- Service role creates requests. Customer/anonymous grants remain unchanged:
-- there is deliberately no public insert/select policy for booking visitors.
commit;
