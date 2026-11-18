-- FIXTURE-* verification seeds must never affect report_loads / money weeks.

create or replace view public.money_invoice_tour_weeks as
with main_invoices as (
  select distinct on (i.amazon_week_year, i.amazon_week)
    i.invoice_id,
    i.amazon_week_year,
    i.amazon_week,
    i.week_start,
    i.week_end,
    (i.amount)::numeric as invoice_total
  from public.invoices i
  where i.invoice_id not like 'FIXTURE-%'
  order by i.amazon_week_year, i.amazon_week, i.amount desc nulls last, i.invoice_id
),
tour_links as (
  select
    public.normalize_tour_id(it.tour_id) as tour_id,
    it.invoice_id
  from public.invoice_trips it
  where it.tour_id is not null
    and public.normalize_tour_id(it.tour_id) <> ''
    and it.invoice_id not like 'FIXTURE-%'

  union

  select
    public.normalize_tour_id(l.trip_id) as tour_id,
    it.invoice_id
  from public.invoice_trips it
  join public.relay_legs l
    on upper(btrim(l.load_id)) = upper(btrim(it.load_id))
  where it.load_id is not null
    and coalesce(l.archived, false) = false
    and public.normalize_tour_id(l.trip_id) <> ''
    and it.invoice_id not like 'FIXTURE-%'

  union

  select
    public.normalize_tour_id(it.load_id) as tour_id,
    it.invoice_id
  from public.invoice_trips it
  where it.load_id is not null
    and public.normalize_tour_id(it.load_id) <> ''
    and it.invoice_id not like 'FIXTURE-%'
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
  true as is_main
from tour_links tl
join main_invoices m on m.invoice_id = tl.invoice_id
where tl.tour_id is not null and tl.tour_id <> '';

comment on view public.money_invoice_tour_weeks is
  'Tours on MAIN invoice week for report_loads. FIXTURE-* seeds are excluded.';
