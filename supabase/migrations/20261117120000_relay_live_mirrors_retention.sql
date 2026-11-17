-- Live mirrors, catch-up, History retention (Relay = source of truth).
-- Additive: safe alongside telegram_trip_alerts / Loads UI work.

create extension if not exists pg_cron;

-- Per-section sync health (source of truth timestamps for catch-up)
create table if not exists public.sync_state (
  section text primary key check (section in ('IN_TRANSIT', 'UPCOMING', 'HISTORY')),
  last_successful_sync_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  syncing boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.sync_state (section)
values ('IN_TRANSIT'), ('UPCOMING'), ('HISTORY')
on conflict (section) do nothing;

-- Catch-up after pause: gap window for overdue suppress + restore summary
create table if not exists public.relay_catch_up (
  id integer primary key default 1 check (id = 1),
  active boolean not null default false,
  gap_start timestamptz,
  gap_end timestamptz,
  missing_trip_ids text[] not null default '{}',
  found_trip_ids text[] not null default '{}',
  removed_trip_ids text[] not null default '{}',
  restore_summary_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.relay_catch_up (id) values (1)
on conflict (id) do nothing;

create table if not exists public.retention_settings (
  id integer primary key default 1 check (id = 1),
  history_retention_days integer not null default 45 check (history_retention_days >= 1),
  updated_at timestamptz not null default now()
);

insert into public.retention_settings (id, history_retention_days)
values (1, 45)
on conflict (id) do nothing;

-- Permanent summaries (no address / phone)
create table if not exists public.trip_summaries (
  id uuid primary key default gen_random_uuid(),
  trip_id text not null unique,
  driver_name text,
  status text,
  tour_state text,
  execution_status text,
  work_type text,
  business_type text,
  equipment text,
  start_time timestamptz,
  end_time timestamptz,
  total_miles numeric,
  payout numeric,
  currency text,
  rate_per_mile numeric,
  facility_codes text[] not null default '{}',
  leg_load_ids text[] not null default '{}',
  leg_count integer not null default 0,
  stop_count integer not null default 0,
  was_late boolean not null default false,
  late_stop_count integer not null default 0,
  needs_review boolean not null default false,
  removed_from_relay boolean not null default false,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  summarized_at timestamptz not null default now()
);

create index if not exists trip_summaries_end_time_idx on public.trip_summaries (end_time desc nulls last);
create index if not exists trip_summaries_driver_idx on public.trip_summaries (driver_name);

create table if not exists public.cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  retention_days integer,
  summarized_count integer not null default 0,
  deleted_trips integer not null default 0,
  deleted_legs integer not null default 0,
  deleted_stops integer not null default 0,
  deleted_activity integer not null default 0,
  deleted_alerts integer not null default 0,
  error text,
  meta jsonb not null default '{}'::jsonb
);

alter table public.relay_trips
  add column if not exists needs_review boolean not null default false;

alter table public.relay_trips
  add column if not exists caught_up_at timestamptz;

create index if not exists relay_trips_needs_review_idx
  on public.relay_trips (needs_review)
  where needs_review = true;

alter table public.sync_state enable row level security;
alter table public.relay_catch_up enable row level security;
alter table public.retention_settings enable row level security;
alter table public.trip_summaries enable row level security;
alter table public.cleanup_runs enable row level security;

do $$ begin
  create policy anon_read_sync_state on public.sync_state for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_sync_state on public.sync_state for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_read_relay_catch_up on public.relay_catch_up for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_relay_catch_up on public.relay_catch_up for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_read_retention_settings on public.retention_settings for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_retention_settings on public.retention_settings for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_write_retention_settings on public.retention_settings
    for update to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_write_retention_settings on public.retention_settings
    for update to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_read_trip_summaries on public.trip_summaries for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_trip_summaries on public.trip_summaries for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_read_cleanup_runs on public.cleanup_runs for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_cleanup_runs on public.cleanup_runs for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- Daily retention: summarize then delete HISTORY older than N days (by end time).
create or replace function public.run_relay_retention()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_cutoff timestamptz;
  v_run_id uuid;
  v_trip_ids text[];
  v_summarized integer := 0;
  v_deleted_trips integer := 0;
  v_deleted_legs integer := 0;
  v_deleted_stops integer := 0;
  v_deleted_activity integer := 0;
  v_deleted_alerts integer := 0;
  v_err text := null;
begin
  select history_retention_days into v_days from public.retention_settings where id = 1;
  v_days := coalesce(v_days, 45);
  v_cutoff := now() - make_interval(days => v_days);

  insert into public.cleanup_runs (started_at, retention_days)
  values (now(), v_days)
  returning id into v_run_id;

  begin
    select coalesce(array_agg(t.trip_id), '{}')
    into v_trip_ids
    from public.relay_trips t
    where t.archived = false
      and t.section = 'HISTORY'
      and coalesce(t.end_time, t.last_seen_at, t.updated_at) < v_cutoff;

    if cardinality(v_trip_ids) > 0 then
      insert into public.trip_summaries (
        trip_id, driver_name, status, tour_state, execution_status, work_type, business_type,
        equipment, start_time, end_time, total_miles, payout, currency, rate_per_mile,
        facility_codes, leg_load_ids, leg_count, stop_count, was_late, late_stop_count,
        needs_review, removed_from_relay, first_seen_at, last_seen_at, summarized_at
      )
      select
        t.trip_id,
        t.driver_name_raw,
        t.status,
        t.tour_state,
        t.execution_status,
        t.work_type,
        t.business_type,
        t.equipment,
        t.start_time,
        t.end_time,
        t.total_miles,
        t.payout,
        t.currency,
        t.rate_per_mile,
        coalesce((
          select array_agg(s.facility_code order by s.seq)
          from public.relay_stops s
          where s.trip_id = t.trip_id and s.facility_code is not null and s.facility_code <> ''
        ), '{}'),
        coalesce((
          select array_agg(l.load_id order by l.load_id)
          from public.relay_legs l
          where l.trip_id = t.trip_id
        ), '{}'),
        coalesce((select count(*)::int from public.relay_legs l where l.trip_id = t.trip_id), 0),
        coalesce((select count(*)::int from public.relay_stops s where s.trip_id = t.trip_id), 0),
        coalesce((
          select bool_or(
            s.actual_arrival is not null
            and s.scheduled_arrival is not null
            and s.actual_arrival > s.scheduled_arrival + interval '15 minutes'
          )
          from public.relay_stops s
          where s.trip_id = t.trip_id
        ), false),
        coalesce((
          select count(*)::int
          from public.relay_stops s
          where s.trip_id = t.trip_id
            and s.actual_arrival is not null
            and s.scheduled_arrival is not null
            and s.actual_arrival > s.scheduled_arrival + interval '15 minutes'
        ), 0),
        coalesce(t.needs_review, false),
        (t.status = 'removed_from_relay'),
        t.created_at,
        t.last_seen_at,
        now()
      from public.relay_trips t
      where t.trip_id = any (v_trip_ids)
      on conflict (trip_id) do update set
        driver_name = excluded.driver_name,
        status = excluded.status,
        tour_state = excluded.tour_state,
        execution_status = excluded.execution_status,
        work_type = excluded.work_type,
        business_type = excluded.business_type,
        equipment = excluded.equipment,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        total_miles = excluded.total_miles,
        payout = excluded.payout,
        currency = excluded.currency,
        rate_per_mile = excluded.rate_per_mile,
        facility_codes = excluded.facility_codes,
        leg_load_ids = excluded.leg_load_ids,
        leg_count = excluded.leg_count,
        stop_count = excluded.stop_count,
        was_late = excluded.was_late,
        late_stop_count = excluded.late_stop_count,
        needs_review = excluded.needs_review,
        removed_from_relay = excluded.removed_from_relay,
        first_seen_at = excluded.first_seen_at,
        last_seen_at = excluded.last_seen_at,
        summarized_at = now();

      get diagnostics v_summarized = row_count;

      select count(*)::int into v_deleted_stops from public.relay_stops where trip_id = any (v_trip_ids);
      select count(*)::int into v_deleted_legs from public.relay_legs where trip_id = any (v_trip_ids);

      delete from public.activity_logs
      where entity_id = any (v_trip_ids);
      get diagnostics v_deleted_activity = row_count;

      delete from public.alerts_sent
      where trip_id = any (v_trip_ids);
      get diagnostics v_deleted_alerts = row_count;

      delete from public.relay_trips
      where trip_id = any (v_trip_ids)
        and section = 'HISTORY';
      get diagnostics v_deleted_trips = row_count;
    end if;

    update public.cleanup_runs
    set
      finished_at = now(),
      summarized_count = v_summarized,
      deleted_trips = v_deleted_trips,
      deleted_legs = v_deleted_legs,
      deleted_stops = v_deleted_stops,
      deleted_activity = v_deleted_activity,
      deleted_alerts = v_deleted_alerts,
      meta = jsonb_build_object('cutoff', v_cutoff, 'trip_ids', coalesce(v_trip_ids, '{}'))
    where id = v_run_id;
  exception when others then
    v_err := SQLERRM;
    update public.cleanup_runs
    set finished_at = now(), error = v_err
    where id = v_run_id;
  end;

  return v_run_id;
end;
$$;

-- Schedule 03:00 daily (UTC). Idempotent replace.
do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'relay-retention-0300';
exception when others then
  null;
end $$;

select cron.schedule(
  'relay-retention-0300',
  '0 3 * * *',
  $$select public.run_relay_retention();$$
);
