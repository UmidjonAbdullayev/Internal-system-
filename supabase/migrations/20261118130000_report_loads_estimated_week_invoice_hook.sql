-- Week assignment:
-- 1) MAIN invoice week (largest $ invoice containing the tour) overrides pickup-date
--    via hook view money_invoice_tour_weeks (payments agent replaces when invoice_trips exists).
-- 2) Else pickup-date Sun–Sat America/Los_Angeles + estimated_week=true.

create or replace view public.money_invoice_tour_weeks as
select
  null::text as tour_id,
  null::int as amazon_week,
  null::int as amazon_week_year,
  null::date as week_start,
  null::date as week_end,
  null::text as invoice_id,
  null::numeric as invoice_total,
  null::boolean as is_main
where false;

comment on view public.money_invoice_tour_weeks is
  'HOOK for payments agent: one row per tour on the MAIN (largest $) invoice of a week. Replace this view to join invoice_trips/invoices. Columns: tour_id (bare), amazon_week, amazon_week_year, week_start, week_end, invoice_id, invoice_total, is_main=true.';

grant select on public.money_invoice_tour_weeks to anon, authenticated;

drop view if exists public.report_loads;

create view public.report_loads as
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
    case when upper(coalesce(s.stop_type, '')) like '%PICK%' then 0 else 1 end as pu_rank,
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
),
base as (
  select
    t.*,
    coalesce(la.leg_load_ids, t.tour_id) as load_ids,
    coalesce(la.leg_count, 0) as leg_count,
    coalesce(fp.pickup_ts, t.start_time) as tour_start_ts,
    public.la_date(coalesce(fp.pickup_ts, t.start_time)) as pickup_la,
    public.la_date(coalesce(ld.delivery_ts, t.end_time)) as delivery_la,
    coalesce(fp.pu_location, '') as pu_location,
    coalesce(ld.del_location, '') as del_location
  from trips t
  left join leg_agg la on la.tour_id = t.tour_id
  left join first_pu fp on fp.tour_id = t.tour_id
  left join last_del ld on ld.tour_id = t.tour_id
  where coalesce(fp.pickup_ts, t.start_time) is not null
),
inv as (
  select distinct on (tour_id)
    tour_id, amazon_week, amazon_week_year, week_start, week_end, invoice_id, invoice_total
  from public.money_invoice_tour_weeks
  where coalesce(is_main, true) = true
    and tour_id is not null
  order by tour_id, invoice_total desc nulls last
)
select
  b.trip_uuid,
  b.trip_id,
  b.tour_id,
  case when b.trip_id ~* '^T-' then b.trip_id else 'T-' || b.tour_id end as trip_display,
  b.load_ids,
  b.leg_count,
  coalesce(o.broker, 'Amazon') as broker,
  coalesce(nullif(btrim(o.driver_name), ''), nullif(btrim(b.driver_name_raw), ''), '') as driver_name,
  b.driver_name_raw as driver_name_raw,
  b.pickup_la as pickup_date,
  b.delivery_la as delivery_date,
  b.pu_location,
  b.del_location,
  b.tour_start_ts,
  b.pickup_la as tour_start_la,
  coalesce(i.week_start, public.amazon_week_start(b.pickup_la)) as week_start,
  coalesce(i.week_end, public.amazon_week_end(b.pickup_la)) as week_end,
  coalesce(i.amazon_week, public.amazon_week_number(b.pickup_la)) as amazon_week,
  coalesce(i.amazon_week_year, public.amazon_week_year(b.pickup_la)) as amazon_week_year,
  'Week' || lpad(
    coalesce(i.amazon_week, public.amazon_week_number(b.pickup_la))::text,
    2, '0'
  ) as week_label,
  (i.tour_id is null) as estimated_week,
  case when i.tour_id is not null then 'invoice_main'::text else 'pickup_estimate'::text end as week_source,
  i.invoice_id,
  case
    when nullif(btrim(coalesce(o.mile, '')), '') is not null then btrim(o.mile)
    when b.total_miles is not null and b.total_miles > 0
      then trim(to_char(round(b.total_miles::numeric, 2), 'FM999999990.00'))
    else ''
  end as mile,
  round(coalesce(b.payout, 0)::numeric, 2) as amazon_paid,
  round(coalesce(o.driver_paid, b.payout, 0)::numeric, 2) as driver_paid,
  case
    when coalesce(b.total_miles, 0) > 0
      then round((coalesce(b.payout, 0) / b.total_miles)::numeric, 4)
    else 0
  end as rpm,
  coalesce(o.comment, '') as comment,
  coalesce(o.dispatch, '') as dispatch,
  b.section,
  b.status,
  b.execution_status,
  b.last_seen_at,
  b.updated_at,
  (o.tour_id is not null) as has_override
from base b
left join public.load_overrides o on o.tour_id = b.tour_id
left join inv i on i.tour_id = b.tour_id;

comment on view public.report_loads is
  'Canonical money row per Relay tour. Week = MAIN invoice week when money_invoice_tour_weeks has tour; else pickup LA Sun–Sat (estimated_week=true). PU/Del from relay_stops. Amazon$=relay_trips.payout.';

grant select on public.report_loads to anon, authenticated;
