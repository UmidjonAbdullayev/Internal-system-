-- Relay tour / leg / stop model (entity.id unique). Legs never stored as trips.

alter table public.loads
  add column if not exists archived boolean not null default false;

create index if not exists loads_archived_idx on public.loads (archived) where archived = false;

update public.loads
set archived = true,
    updated_at = now()
where coalesce(source, '') = 'amazon_relay'
  and archived = false;

create table if not exists public.relay_trips (
  id uuid primary key default gen_random_uuid(),
  trip_id text not null unique,
  section text check (section is null or section in ('IN_TRANSIT','UPCOMING','HISTORY')),
  relay_version text,
  last_seen_at timestamptz,
  tour_state text,
  execution_status text,
  work_type text,
  business_type text,
  start_time timestamptz,
  end_time timestamptz,
  total_miles numeric,
  payout numeric,
  currency text,
  rate_per_mile numeric,
  driver_name_raw text,
  equipment text,
  status text,
  content_hash text,
  raw jsonb not null default '{}'::jsonb,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists relay_trips_section_idx on public.relay_trips (section) where archived = false;
create index if not exists relay_trips_last_seen_idx on public.relay_trips (last_seen_at);
create index if not exists relay_trips_status_idx on public.relay_trips (status);

create table if not exists public.relay_legs (
  id uuid primary key default gen_random_uuid(),
  load_id text not null unique,
  trip_id text not null references public.relay_trips (trip_id) on delete cascade,
  facility_sequence text,
  execution_status text,
  equipment_type text,
  miles numeric,
  payout numeric,
  tractor_id text,
  trailer_id text,
  driver_name_raw text,
  cpt timestamptz,
  content_hash text,
  raw jsonb not null default '{}'::jsonb,
  archived boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists relay_legs_trip_idx on public.relay_legs (trip_id);

create table if not exists public.relay_stops (
  id uuid primary key default gen_random_uuid(),
  stop_id text not null unique,
  load_id text not null references public.relay_legs (load_id) on delete cascade,
  trip_id text not null,
  seq integer,
  stop_type text,
  facility_code text,
  address text,
  city text,
  state text,
  zip text,
  time_zone text,
  scheduled_arrival timestamptz,
  actual_arrival timestamptz,
  scheduled_departure timestamptz,
  actual_departure timestamptz,
  eta timestamptz,
  scheduled_arrival_local text,
  actual_arrival_local text,
  raw jsonb not null default '{}'::jsonb,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists relay_stops_load_idx on public.relay_stops (load_id);
create index if not exists relay_stops_trip_idx on public.relay_stops (trip_id);

create table if not exists public.relay_section_snapshots (
  section text primary key check (section in ('IN_TRANSIT','UPCOMING','HISTORY')),
  trip_ids text[] not null default '{}',
  total_records integer not null default 0,
  crm_count integer not null default 0,
  mismatch boolean not null default false,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.relay_trips enable row level security;
alter table public.relay_legs enable row level security;
alter table public.relay_stops enable row level security;
alter table public.relay_section_snapshots enable row level security;

do $$ begin
  create policy anon_read_relay_trips on public.relay_trips for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_relay_trips on public.relay_trips for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_read_relay_legs on public.relay_legs for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_relay_legs on public.relay_legs for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_read_relay_stops on public.relay_stops for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_relay_stops on public.relay_stops for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_read_relay_section_snapshots on public.relay_section_snapshots for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_relay_section_snapshots on public.relay_section_snapshots for select to authenticated using (true);
exception when duplicate_object then null; end $$;
