-- Money accuracy STEP 1: unified report_loads (one row per Relay tour)
-- keeps loads / load_reports as legacy (no deletes)

comment on table public.loads is
  'LEGACY money source — do not use for Drivers/Gross/Reports totals. Prefer report_loads.';
comment on table public.load_reports is
  'LEGACY ops sheet rows — superseded by report_loads + load_overrides. Kept for audit/migration.';

-- ---------------------------------------------------------------------------
-- Manual / user overrides keyed by normalized tour id (bare, no T-)
-- ---------------------------------------------------------------------------
create table if not exists public.load_overrides (
  tour_id text primary key,
  driver_name text,
  driver_paid numeric(12,2),
  comment text,
  dispatch text,
  mile text,
  broker text,
  source text not null default 'migrated'
    check (source in ('migrated', 'manual', 'sync')),
  legacy_report_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.load_overrides is
  'User/manual fields for report_loads, keyed by bare Relay tour id.';

alter table public.load_overrides enable row level security;

do $$ begin
  create policy anon_read_load_overrides on public.load_overrides for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_insert_load_overrides on public.load_overrides for insert to anon with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_update_load_overrides on public.load_overrides for update to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_delete_load_overrides on public.load_overrides for delete to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_all_load_overrides on public.load_overrides for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Helpers: normalize tour id, place string, Amazon week (Sun–Sat, America/Los_Angeles)
-- ---------------------------------------------------------------------------
create or replace function public.normalize_tour_id(raw text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(nullif(btrim(raw), ''), ''), '^T-', ''));
$$;

create or replace function public.relay_stop_place(
  city text, state text, facility_code text, address text
)
returns text
language sql
immutable
as $$
  select case
    when nullif(btrim(coalesce(city, '')), '') is not null
         and nullif(btrim(coalesce(state, '')), '') is not null
      then btrim(city) || ', ' || upper(left(btrim(state), 2))
    when nullif(btrim(coalesce(facility_code, '')), '') is not null
      then btrim(facility_code)
    when nullif(btrim(coalesce(address, '')), '') is not null
      then left(btrim(address), 120)
    else ''
  end;
$$;

-- LA calendar date for a timestamptz
create or replace function public.la_date(ts timestamptz)
returns date
language sql
immutable
as $$
  select (ts at time zone 'America/Los_Angeles')::date;
$$;

-- Sunday-start week containing an LA calendar date
create or replace function public.amazon_week_start(d date)
returns date
language sql
immutable
as $$
  -- extract(dow): 0=Sunday .. 6=Saturday
  select d - extract(dow from d)::int;
$$;

create or replace function public.amazon_week_end(d date)
returns date
language sql
immutable
as $$
  select public.amazon_week_start(d) + 6;
$$;

-- Amazon week number: ISO week of the Monday inside the Sun–Sat week
-- (Nov 8–14 2026 → Week46)
create or replace function public.amazon_week_number(d date)
returns int
language sql
immutable
as $$
  select extract(week from (public.amazon_week_start(d) + 1))::int;
$$;

create or replace function public.amazon_week_year(d date)
returns int
language sql
immutable
as $$
  select extract(isoyear from (public.amazon_week_start(d) + 1))::int;
$$;

-- ---------------------------------------------------------------------------
-- report_loads: one row per relay_trips.trip_id (tour uniqueness)
-- Amazon $ = trip.payout; PU/Del live from relay_stops; week by first pickup LA
-- ---------------------------------------------------------------------------
create or replace view public.report_loads as
with trips as (
  select
    t.id as trip_uuid,
    t.trip_id,
    public.normalize_tour_id(t.trip_id) as tour_id,
    t.payout,
    t.total_miles,
    t.driver_name_raw,
    t.start_time,
    t.end_time,
    t.section,
    t.status,
    t.execution_status,
    t.archived,
    t.last_seen_at,
    t.updated_at
  from public.relay_trips t
  where coalesce(t.archived, false) = false
    and public.normalize_tour_id(t.trip_id) <> ''
),
leg_agg as (
  select
    public.normalize_tour_id(l.trip_id) as tour_id,
    string_agg(distinct l.load_id, '/' order by l.load_id) as leg_load_ids,
    count(*)::int as leg_count
  from public.relay_legs l
  where coalesce(l.archived, false) = false
  group by 1
),
ordered_stops as (
  select
    public.normalize_tour_id(s.trip_id) as tour_id,
    s.seq,
    s.stop_type,
    coalesce(s.actual_arrival, s.scheduled_arrival, s.eta) as stop_ts,
    public.relay_stop_place(s.city, s.state, s.facility_code, s.address) as place,
    case
      when upper(coalesce(s.stop_type, '')) like '%PICK%' then 0
      else 1
    end as pu_rank,
    case
      when upper(coalesce(s.stop_type, '')) like '%DROP%'
        or upper(coalesce(s.stop_type, '')) like '%DELIV%' then 0
      else 1
    end as del_rank
  from public.relay_stops s
  where coalesce(s.archived, false) = false
),
first_pu as (
  select distinct on (tour_id)
    tour_id, stop_ts as pickup_ts, place as pu_location
  from ordered_stops
  order by tour_id, pu_rank, seq nulls last, stop_ts nulls last
),
last_del as (
  select distinct on (tour_id)
    tour_id, stop_ts as delivery_ts, place as del_location
  from ordered_stops
  order by tour_id, del_rank, seq desc nulls last, stop_ts desc nulls last
)
select
  t.trip_uuid,
  t.trip_id,
  t.tour_id,
  case
    when t.trip_id ~* '^T-' then t.trip_id
    else 'T-' || t.tour_id
  end as trip_display,
  coalesce(la.leg_load_ids, t.tour_id) as load_ids,
  coalesce(la.leg_count, 0) as leg_count,
  coalesce(o.broker, 'Amazon') as broker,
  coalesce(nullif(btrim(o.driver_name), ''), nullif(btrim(t.driver_name_raw), ''), '') as driver_name,
  t.driver_name_raw as driver_name_raw,
  public.la_date(coalesce(fp.pickup_ts, t.start_time)) as pickup_date,
  public.la_date(coalesce(ld.delivery_ts, t.end_time)) as delivery_date,
  coalesce(fp.pu_location, '') as pu_location,
  coalesce(ld.del_location, '') as del_location,
  coalesce(fp.pickup_ts, t.start_time) as tour_start_ts,
  public.la_date(coalesce(fp.pickup_ts, t.start_time)) as tour_start_la,
  public.amazon_week_start(public.la_date(coalesce(fp.pickup_ts, t.start_time))) as week_start,
  public.amazon_week_end(public.la_date(coalesce(fp.pickup_ts, t.start_time))) as week_end,
  public.amazon_week_number(public.la_date(coalesce(fp.pickup_ts, t.start_time))) as amazon_week,
  public.amazon_week_year(public.la_date(coalesce(fp.pickup_ts, t.start_time))) as amazon_week_year,
  'Week' || lpad(
    public.amazon_week_number(public.la_date(coalesce(fp.pickup_ts, t.start_time)))::text,
    2, '0'
  ) as week_label,
  case
    when nullif(btrim(coalesce(o.mile, '')), '') is not null then btrim(o.mile)
    when t.total_miles is not null and t.total_miles > 0
      then trim(to_char(round(t.total_miles::numeric, 2), 'FM999999990.00'))
    else ''
  end as mile,
  round(coalesce(t.payout, 0)::numeric, 2) as amazon_paid,
  round(
    coalesce(o.driver_paid, t.payout, 0)::numeric,
    2
  ) as driver_paid,
  case
    when coalesce(t.total_miles, 0) > 0
      then round((coalesce(t.payout, 0) / t.total_miles)::numeric, 4)
    else 0
  end as rpm,
  coalesce(o.comment, '') as comment,
  coalesce(o.dispatch, '') as dispatch,
  t.section,
  t.status,
  t.execution_status,
  t.last_seen_at,
  t.updated_at,
  (o.tour_id is not null) as has_override
from trips t
left join leg_agg la on la.tour_id = t.tour_id
left join first_pu fp on fp.tour_id = t.tour_id
left join last_del ld on ld.tour_id = t.tour_id
left join public.load_overrides o on o.tour_id = t.tour_id
where coalesce(fp.pickup_ts, t.start_time) is not null;

comment on view public.report_loads is
  'Canonical money row: one per Relay tour. Amazon $=relay_trips.payout; week=first pickup LA Sun–Sat; PU/Del from relay_stops.';

grant select on public.report_loads to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Migrate load_reports → load_overrides (one row per tour; never lose fields)
-- ---------------------------------------------------------------------------
create or replace function public.migrate_load_reports_to_overrides()
returns table (migrated_tours int, source_report_rows int)
language plpgsql
security definer
as $$
declare
  v_tours int;
  v_rows int;
begin
  select count(*) into v_rows from public.load_reports;

  with ranked as (
    select
      public.normalize_tour_id(coalesce(nullif(btrim(trip), ''), nullif(btrim(load_ids), ''))) as tour_id,
      id,
      driver_name,
      driver_paid,
      comment,
      dispatch,
      mile,
      broker,
      source,
      updated_at,
      created_at,
      case when source = 'manual' then 0 else 1 end as source_rank,
      case when nullif(btrim(dispatch), '') is not null then 0 else 1 end as dispatch_rank,
      case
        when comment is not null and btrim(comment) <> '' and comment !~* '^Week\d+$' then 0
        else 1
      end as comment_rank,
      case when driver_paid is distinct from amazon_paid then 0 else 1 end as paid_rank
    from public.load_reports
  ),
  usable as (
    select * from ranked where tour_id is not null and tour_id <> ''
  ),
  best as (
    select distinct on (tour_id)
      tour_id, id, driver_name, driver_paid, comment, dispatch, mile, broker, source
    from usable
    order by
      tour_id,
      source_rank,
      dispatch_rank,
      comment_rank,
      paid_rank,
      updated_at desc nulls last,
      created_at desc nulls last
  ),
  ids as (
    select tour_id, array_agg(id order by id) as legacy_report_ids
    from usable
    group by tour_id
  )
  insert into public.load_overrides as lo (
    tour_id, driver_name, driver_paid, comment, dispatch, mile, broker, source, legacy_report_ids, updated_at
  )
  select
    b.tour_id,
    nullif(btrim(b.driver_name), ''),
    b.driver_paid,
    coalesce(b.comment, ''),
    coalesce(b.dispatch, ''),
    nullif(btrim(b.mile), ''),
    coalesce(nullif(btrim(b.broker), ''), 'Amazon'),
    case when b.source = 'manual' then 'manual' else 'migrated' end,
    coalesce(i.legacy_report_ids, array[b.id]::uuid[]),
    now()
  from best b
  join ids i on i.tour_id = b.tour_id
  on conflict (tour_id) do update set
    driver_name = coalesce(excluded.driver_name, lo.driver_name),
    driver_paid = coalesce(excluded.driver_paid, lo.driver_paid),
    comment = case
      when nullif(btrim(excluded.comment), '') is not null then excluded.comment
      else lo.comment
    end,
    dispatch = case
      when nullif(btrim(excluded.dispatch), '') is not null then excluded.dispatch
      else lo.dispatch
    end,
    mile = coalesce(excluded.mile, lo.mile),
    broker = coalesce(excluded.broker, lo.broker),
    legacy_report_ids = excluded.legacy_report_ids,
    updated_at = now();

  get diagnostics v_tours = row_count;
  migrated_tours := v_tours;
  source_report_rows := v_rows;
  return next;
end;
$$;

grant execute on function public.migrate_load_reports_to_overrides() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Legacy duplicate inventory for Data checks (reads loads / load_reports)
-- ---------------------------------------------------------------------------
create or replace view public.money_legacy_twin_pairs as
with n as (
  select
    id,
    load_ids,
    trip,
    amazon_paid,
    driver_paid,
    load_uuid,
    public.normalize_tour_id(load_ids) as bare_load
  from public.load_reports
  where nullif(btrim(load_ids), '') is not null
)
select
  bare_load,
  count(*)::int as row_count,
  array_agg(load_ids order by load_ids) as load_ids,
  array_agg(trip order by load_ids) as trips,
  array_agg(amazon_paid order by load_ids) as amazon_amounts,
  round(sum(amazon_paid)::numeric, 2) as summed_amazon,
  round(max(amazon_paid)::numeric, 2) as max_amazon,
  round((sum(amazon_paid) - max(amazon_paid))::numeric, 2) as double_counted_extra
from n
group by bare_load
having count(*) > 1
order by bare_load;

create or replace view public.money_legacy_stacked_trips as
with trip_and_legs as (
  select
    r.trip,
    r.load_ids,
    r.amazon_paid,
    public.normalize_tour_id(coalesce(l.parent_trip_id, l.load_id)) as trip_key,
    public.normalize_tour_id(l.load_id) as bare
  from public.load_reports r
  join public.loads l on l.id = r.load_uuid
)
select
  trip_key,
  count(*) filter (where bare = trip_key)::int as trip_level_rows,
  count(*) filter (where bare <> trip_key)::int as leg_rows,
  round(sum(amazon_paid) filter (where bare = trip_key)::numeric, 2) as trip_level_amazon,
  round(sum(amazon_paid) filter (where bare <> trip_key)::numeric, 2) as legs_amazon,
  round(sum(amazon_paid)::numeric, 2) as total_if_all_counted,
  array_agg(load_ids order by load_ids) as all_load_ids
from trip_and_legs
group by trip_key
having count(*) filter (where bare = trip_key) > 0
   and count(*) filter (where bare <> trip_key) > 0
order by trip_level_amazon desc nulls last, trip_key;

grant select on public.money_legacy_twin_pairs to anon, authenticated;
grant select on public.money_legacy_stacked_trips to anon, authenticated;

-- Run migration once
select * from public.migrate_load_reports_to_overrides();


-- NOTE: migrate_load_reports_to_overrides was corrected in apply
-- fix_load_overrides_migrate_prefer_tour (prefer tour-level rows; driver_paid
-- override only when tour-level/manual differs from amazon_paid).
