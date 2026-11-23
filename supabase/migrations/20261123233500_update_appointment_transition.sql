begin;

-- Update trigger function to allow reversible transitions:
-- pending -> confirmed, rejected, cancelled
-- confirmed -> completed, cancelled, rejected, pending
-- completed -> confirmed, rejected, cancelled
-- rejected -> confirmed, cancelled
-- cancelled -> confirmed, rejected
create or replace function private.enforce_appointment_transition()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status is distinct from old.status and not (
    (old.status = 'pending' and new.status in ('confirmed','rejected','cancelled')) or
    (old.status = 'confirmed' and new.status in ('completed','cancelled','rejected','pending')) or
    (old.status = 'completed' and new.status in ('confirmed','rejected','cancelled')) or
    (old.status = 'rejected' and new.status in ('confirmed','cancelled')) or
    (old.status = 'cancelled' and new.status in ('confirmed','rejected'))
  ) then raise exception 'Invalid appointment status transition' using errcode = '23514';
  end if;
  return new;
end;
$$;

commit;
