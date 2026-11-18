-- IS-53: Fix week ↔ invoice reconciliation after #49 PART2 broke money_invoice_tour_weeks.
-- Rules:
--   1) MAIN = largest real AZNG invoice per week; tour via tour_id | relay_legs | load=trip
--   2) Adjustment invoices do NOT move trips (excluded from this view)
--   3) report_loads money_bucket: income (COMPLETED/TONU) | expected | pending_invoice

drop view if exists public.report_loads;
drop view if exists public.money_invoice_tour_weeks;

create view public.money_invoice_tour_weeks as
with main_invoices as (
  select distinct on (i.amazon_week_year, i.amazon_week)
    i.invoice_id,
    i.amazon_week_year,
    i.amazon_week,
    i.week_start,
    i.week_end,
    (i.amount)::numeric as invoice_total,
    coalesce(nullif(btrim(i.status), ''), nullif(btrim(i.payment_status_raw), ''), '') as paid_status
  from public.invoices i
  where i.invoice_id ~ '^AZNG[0-9A-F]'
  order by i.amazon_week_year, i.amazon_week, i.amount desc nulls last, i.invoice_id
),
tour_links as (
  select
    public.normalize_tour_id(it.tour_id) as tour_id,
    it.invoice_id
  from public.invoice_trips it
  join main_invoices m on m.invoice_id = it.invoice_id
  where it.tour_id is not null
    and public.normalize_tour_id(it.tour_id) <> ''

  union

  select
    public.normalize_tour_id(l.trip_id) as tour_id,
    it.invoice_id
  from public.invoice_trips it
  join main_invoices m on m.invoice_id = it.invoice_id
  join public.relay_legs l
    on upper(btrim(l.load_id)) = upper(btrim(it.load_id))
  where it.load_id is not null
    and coalesce(l.archived, false) = false
    and public.normalize_tour_id(l.trip_id) <> ''

  union

  select
    public.normalize_tour_id(it.load_id) as tour_id,
    it.invoice_id
  from public.invoice_trips it
  join main_invoices m on m.invoice_id = it.invoice_id
  where it.load_id is not null
    and public.normalize_tour_id(it.load_id) <> ''
    and exists (
      select 1
      from public.relay_trips t
      where public.normalize_tour_id(t.trip_id) = public.normalize_tour_id(it.load_id)
        and coalesce(t.archived, false) = false
    )
)
select
  tl.tour_id,
  m.amazon_week,
  m.amazon_week_year,
  m.week_start,
  m.week_end,
  m.invoice_id,
  m.invoice_total,
  m.paid_status,
  true as is_main
from tour_links tl
join main_invoices m on m.invoice_id = tl.invoice_id
where tl.tour_id is not null and tl.tour_id <> '';

comment on view public.money_invoice_tour_weeks is
  'Tours on MAIN (largest $) real AZNG invoice per week. Adj invoices excluded — they do not move trips. load_id resolved via relay_legs / relay_trips.';

grant select on public.money_invoice_tour_weeks to anon, authenticated;

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
  select
    tour_id, amazon_week, amazon_week_year, week_start, week_end,
    invoice_id, invoice_total, paid_status
  from public.money_invoice_tour_weeks
  where coalesce(is_main, true) = true
    and tour_id is not null
)
select
  b.trip_uuid,
  b.trip_id,
  b.tour_id,
  case
    when coalesce(b.leg_count, 0) > 1 then
      case when b.trip_id ~* '^T-' then b.trip_id else 'T-' || b.tour_id end
    else b.tour_id
  end as trip_display,
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
  coalesce(i.paid_status, '') as paid_status,
  case
    when nullif(btrim(coalesce(o.mile, '')), '') is not null then btrim(o.mile)
    when b.total_miles is not null and b.total_miles > 0
      then trim(to_char(round(b.total_miles::numeric, 2), 'FM999999990.00'))
    else ''
  end as mile,
  round(coalesce(b.payout, 0)::numeric, 2) as amazon_paid,
  round(
    coalesce(
      case when o.source = 'manual' then o.driver_paid end,
      b.payout,
      0
    )::numeric,
    2
  ) as driver_paid,
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
  (o.tour_id is not null and o.source = 'manual') as has_override,
  coalesce(o.source, '') as override_source,
  -- TONU: explicit status/mile, or cancelled with positive payout (Relay TONU fee pattern)
  (
    upper(coalesce(b.status, '')) like '%TONU%'
    or upper(coalesce(b.execution_status, '')) like '%TONU%'
    or upper(coalesce(o.mile, '')) like '%TONU%'
    or (
      upper(coalesce(b.status, '')) = 'CANCELLED'
      and coalesce(b.payout, 0) > 0
    )
  ) as is_tonu,
  case
    when upper(coalesce(b.status, '')) = 'COMPLETED'
      or upper(coalesce(b.status, '')) like '%TONU%'
      or upper(coalesce(b.execution_status, '')) like '%TONU%'
      or upper(coalesce(o.mile, '')) like '%TONU%'
      or (
        upper(coalesce(b.status, '')) = 'CANCELLED'
        and coalesce(b.payout, 0) > 0
      )
    then
      case
        when i.tour_id is not null then 'income'::text
        else 'pending_invoice'::text
      end
    else 'expected'::text
  end as money_bucket
from base b
left join public.load_overrides o on o.tour_id = b.tour_id
left join inv i on i.tour_id = b.tour_id;

comment on view public.report_loads is
  'Canonical money row per Relay tour. Week = MAIN invoice only (adj do not move). money_bucket: income | pending_invoice | expected. Trip T- only when leg_count>1.';

grant select on public.report_loads to anon, authenticated;
