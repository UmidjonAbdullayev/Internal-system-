-- BOOKED / CANCELLED / 30-min REMINDER alerts (trip-alerts minute check).
-- relay_legs.cancelled_first_seen_at: set when a leg's execution_status changes to
-- CANCELLED (UPDATE only — a leg first seen already cancelled is not "news").
alter table public.relay_legs
  add column if not exists cancelled_first_seen_at timestamptz;

create or replace function public.relay_legs_mark_cancelled_first_seen()
returns trigger language plpgsql set search_path = public as $$
begin
  if upper(coalesce(new.execution_status, '')) like '%CANCEL%'
     and upper(coalesce(old.execution_status, '')) not like '%CANCEL%' then
    new.cancelled_first_seen_at := now();
  elsif new.cancelled_first_seen_at is null then
    new.cancelled_first_seen_at := old.cancelled_first_seen_at;
  end if;
  return new;
end;
$$;

drop trigger if exists relay_legs_cancelled_first_seen on public.relay_legs;
create trigger relay_legs_cancelled_first_seen
  before update of execution_status on public.relay_legs
  for each row execute function public.relay_legs_mark_cancelled_first_seen();

-- Only events after this time are alerted (no flood of old bookings/cancellations).
alter table public.telegram_alert_config
  add column if not exists lifecycle_alerts_since timestamptz;
update public.telegram_alert_config
   set lifecycle_alerts_since = now()
 where id = 1 and lifecycle_alerts_since is null;

-- Turn the new types on (trip_booked / cancelled rows existed, disabled).
insert into public.telegram_alert_settings (alert_type, enabled)
values ('trip_booked', true), ('cancelled', true), ('reminder', true)
on conflict (alert_type) do update set enabled = true, updated_at = now();
