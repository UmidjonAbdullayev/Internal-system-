-- trip-alerts used a session advisory lock. Through the connection pooler the lock and
-- unlock land on different connections, so the lock stayed held and most minute checks
-- returned "locked" (arrivals posted up to ~5 min late). Replace with a 2-minute lease
-- row: same RPC names, so the edge function is unchanged. A crashed run frees itself.
create table if not exists public.trip_alerts_lease (
  id int primary key default 1 check (id = 1),
  locked_until timestamptz
);
insert into public.trip_alerts_lease (id, locked_until) values (1, null)
  on conflict (id) do nothing;
alter table public.trip_alerts_lease enable row level security;
revoke all on public.trip_alerts_lease from anon, authenticated;

create or replace function public.try_trip_alerts_lock()
returns boolean language plpgsql security definer set search_path = public as $$
declare got int;
begin
  perform pg_advisory_unlock_all();
  update public.trip_alerts_lease
     set locked_until = now() + interval '2 minutes'
   where id = 1 and (locked_until is null or locked_until < now());
  get diagnostics got = row_count;
  return got = 1;
end;
$$;

create or replace function public.release_trip_alerts_lock()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.trip_alerts_lease set locked_until = null where id = 1;
  return true;
end;
$$;

revoke execute on function public.try_trip_alerts_lock() from public, anon, authenticated;
revoke execute on function public.release_trip_alerts_lock() from public, anon, authenticated;
grant execute on function public.try_trip_alerts_lock() to service_role;
grant execute on function public.release_trip_alerts_lock() to service_role;
