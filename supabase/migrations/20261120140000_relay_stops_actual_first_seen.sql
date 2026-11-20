-- When our sync first saw a stop's check-in (actual_arrival null -> set). Compared with
-- actual_arrival it measures how late Relay posts check-ins (YMS / app / geofence),
-- separately from our own sync gaps.
alter table public.relay_stops
  add column if not exists actual_arrival_first_seen_at timestamptz;

create or replace function public.relay_stops_mark_actual_first_seen()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.actual_arrival is not null and new.actual_arrival_first_seen_at is null then
    if tg_op = 'INSERT' or old.actual_arrival is null then
      new.actual_arrival_first_seen_at := now();
    else
      new.actual_arrival_first_seen_at := old.actual_arrival_first_seen_at;
    end if;
  elsif tg_op = 'UPDATE' and new.actual_arrival_first_seen_at is null then
    new.actual_arrival_first_seen_at := old.actual_arrival_first_seen_at;
  end if;
  return new;
end;
$$;

drop trigger if exists relay_stops_actual_first_seen on public.relay_stops;
create trigger relay_stops_actual_first_seen
  before insert or update of actual_arrival on public.relay_stops
  for each row execute function public.relay_stops_mark_actual_first_seen();
