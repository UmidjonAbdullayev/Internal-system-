-- trip_events audit + source_tab; force cancelled out of live sections (no deletes).

create table if not exists public.trip_events (
  id uuid primary key default gen_random_uuid(),
  trip_id text not null,
  event_type text not null,
  from_section text,
  to_section text,
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trip_events_trip_id_idx on public.trip_events (trip_id);
create index if not exists trip_events_created_at_idx on public.trip_events (created_at desc);

alter table public.trip_events enable row level security;

do $$ begin
  create policy anon_read_trip_events on public.trip_events for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_trip_events on public.trip_events for select to authenticated using (true);
exception when duplicate_object then null; end $$;

alter table public.relay_trips
  add column if not exists source_tab text;

-- One-time: cancelled tours must not sit in UPCOMING / IN_TRANSIT.
with doomed as (
  select trip_id, section as from_section, status as from_status
  from public.relay_trips
  where archived = false
    and section in ('UPCOMING', 'IN_TRANSIT')
    and (
      upper(coalesce(status, '')) ~ 'CANCEL'
      or upper(coalesce(execution_status, '')) ~ 'CANCEL'
      or lower(coalesce(tour_state, '')) ~ 'cancel'
    )
),
moved as (
  update public.relay_trips t
  set
    section = 'HISTORY',
    status = case
      when upper(coalesce(t.status, '')) ~ 'CANCEL' then t.status
      else 'CANCELLED'
    end,
    updated_at = now()
  from doomed d
  where t.trip_id = d.trip_id
  returning t.trip_id, d.from_section, d.from_status, t.status as to_status
)
insert into public.trip_events (trip_id, event_type, from_section, to_section, from_status, to_status, detail)
select
  m.trip_id,
  'cancelled_to_history_cleanup',
  m.from_section,
  'HISTORY',
  m.from_status,
  m.to_status,
  jsonb_build_object('reason', 'one_time_cancelled_cleanup')
from moved m;
