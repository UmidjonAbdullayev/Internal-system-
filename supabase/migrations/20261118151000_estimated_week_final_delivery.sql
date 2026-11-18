-- Estimated week for not-yet-invoiced tours = FINAL DELIVERY
-- (actual departure last stop, else scheduled departure, else arrival/eta),
-- Sun–Sat America/Los_Angeles. MAIN invoice week unchanged.
-- Week income remains SUM(trip payout) for completed/TONU — never invoice amounts.

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
    -- Pickup: arrival-oriented
    coalesce(s.actual_arrival, s.scheduled_arrival, s.eta) as pu_ts,
    -- Final delivery: actual departure, else scheduled departure, else arrival/eta
    coalesce(
      s.actual_departure,
      s.scheduled_departure,
      s.actual_arrival,
      s.scheduled_arrival,
      s.eta
    ) as del_ts,
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
    tour_id, pu_ts as pickup_ts, place as pu_location
  from ordered_stops
  order by tour_id, pu_rank, seq nulls last, pu_ts nulls last
),
last_del as (
  select distinct on (tour_id)
    tour_id, del_ts as delivery_ts, place as del_location
  from ordered_stops
  order by tour_id, del_rank, seq desc nulls last, del_ts desc nulls last
),
base as (
  select
    t.*,
    coalesce(la.leg_load_ids, t.tour_id) as load_ids,
    coalesce(la.leg_count, 0) as leg_count,
    coalesce(fp.pickup_ts, t.start_time) as tour_start_ts,
    public.la_date(coalesce(fp.pickup_ts, t.start_time)) as pickup_la,
    -- Final delivery LA date (for estimated week + delivery_date column)
    public.la_date(coalesce(ld.delivery_ts, t.end_time)) as delivery_la,
    coalesce(fp.pu_location, '') as pu_location,
    coalesce(ld.del_location, '') as del_location
  from trips t
  left join leg_agg la on la.tour_id = t.tour_id
  left join first_pu fp on fp.tour_id = t.tour_id
  left join last_del ld on ld.tour_id = t.tour_id
  where coalesce(fp.pickup_ts, t.start_time) is not null
    or coalesce(ld.delivery_ts, t.end_time) is not null
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
  -- MAIN invoice week wins; else estimated week from FINAL DELIVERY (not pickup)
  coalesce(i.week_start, public.amazon_week_start(coalesce(b.delivery_la, b.pickup_la))) as week_start,
  coalesce(i.week_end, public.amazon_week_end(coalesce(b.delivery_la, b.pickup_la))) as week_end,
  coalesce(i.amazon_week, public.amazon_week_number(coalesce(b.delivery_la, b.pickup_la))) as amazon_week,
  coalesce(i.amazon_week_year, public.amazon_week_year(coalesce(b.delivery_la, b.pickup_la))) as amazon_week_year,
  'Week' || lpad(
    coalesce(i.amazon_week, public.amazon_week_number(coalesce(b.delivery_la, b.pickup_la)))::text,
    2, '0'
  ) as week_label,
  (i.tour_id is null) as estimated_week,
  case when i.tour_id is not null then 'invoice_main'::text else 'delivery_estimate'::text end as week_source,
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
  'One row per Relay tour. amazon_paid = trip payout. Week = MAIN invoice else FINAL DELIVERY LA Sun–Sat (delivery_estimate). money_bucket: income | pending_invoice | expected.';

grant select on public.report_loads to anon, authenticated;
