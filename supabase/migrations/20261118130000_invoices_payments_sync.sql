-- Amazon Relay settlements → invoices / invoice_trips
-- Feeds money_invoice_tour_weeks (MAIN invoice week override for report_loads).

-- ---------------------------------------------------------------------------
-- Week bounds from contextId year#week (Week 1 = Sun–Sat containing Jan 1)
-- ---------------------------------------------------------------------------
create or replace function public.amazon_week_bounds(p_year int, p_week int)
returns table(week_start date, week_end date)
language sql
immutable
as $$
  with w1 as (
    select public.amazon_week_start(make_date(p_year, 1, 1)) as start
  )
  select
    (w1.start + ((p_week - 1) * 7))::date as week_start,
    (w1.start + ((p_week - 1) * 7) + 6)::date as week_end
  from w1;
$$;

comment on function public.amazon_week_bounds(int, int) is
  'Sun–Sat LA Amazon week bounds for year + week number (contextId 2026#46 → Nov 8–14 2026).';

-- ---------------------------------------------------------------------------
-- invoices (one row per Relay settlementList item; upsert by invoice_id)
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  invoice_id text primary key,
  amazon_week_year int not null,
  amazon_week int not null,
  week_label text not null,
  week_start date not null,
  week_end date not null,
  work_type text,
  amount numeric(12,2) not null,
  status text not null,
  payment_status_raw text,
  invoice_date date,
  expected_payment_date date,
  paid_at timestamptz,
  invoice_status text,
  credit_note text,
  tour_ids text[] not null default '{}',
  load_ids text[] not null default '{}',
  raw jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoices_week_idx
  on public.invoices (amazon_week_year, amazon_week);
create index if not exists invoices_status_idx on public.invoices (status);

comment on table public.invoices is
  'Amazon Relay settlementList items (PAYABLES). Upsert by invoice_id; never delete.';

-- ---------------------------------------------------------------------------
-- invoice_trips — membership (tour and/or load); a trip may appear in several invoices
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_trips (
  id bigserial primary key,
  invoice_id text not null references public.invoices(invoice_id) on delete cascade,
  amazon_week_year int not null,
  amazon_week int not null,
  week_label text not null,
  tour_id text,
  load_id text,
  created_at timestamptz not null default now(),
  constraint invoice_trips_has_member check (tour_id is not null or load_id is not null)
);

create unique index if not exists invoice_trips_tour_uidx
  on public.invoice_trips (invoice_id, tour_id)
  where tour_id is not null;

create unique index if not exists invoice_trips_load_uidx
  on public.invoice_trips (invoice_id, load_id)
  where load_id is not null;

create index if not exists invoice_trips_tour_idx on public.invoice_trips (tour_id);
create index if not exists invoice_trips_load_idx on public.invoice_trips (load_id);
create index if not exists invoice_trips_week_idx
  on public.invoice_trips (amazon_week_year, amazon_week);

comment on table public.invoice_trips is
  'Membership of tours/loads on Relay invoices. Adjustments may include earlier-week trips.';

-- ---------------------------------------------------------------------------
-- payments_summary — latest Relay payments-summary snapshot (singleton)
-- ---------------------------------------------------------------------------
create table if not exists public.payments_summary (
  id int primary key default 1 check (id = 1),
  year_to_date_payment_amt numeric(14,2),
  pending_invoice_payment_amt numeric(14,2),
  expected_payment_date date,
  time_zone text,
  raw jsonb,
  last_synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payments_summary is
  'Latest Relay GET /api/financials/v1/payments-summary (singleton id=1).';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.invoices enable row level security;
alter table public.invoice_trips enable row level security;
alter table public.payments_summary enable row level security;

do $$ begin
  create policy anon_read_invoices on public.invoices for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_invoices on public.invoices for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy anon_read_invoice_trips on public.invoice_trips for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_invoice_trips on public.invoice_trips for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy anon_read_payments_summary on public.payments_summary for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_payments_summary on public.payments_summary for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- money_invoice_tour_weeks — MAIN invoice week per tour (for report_loads)
-- ---------------------------------------------------------------------------
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

  -- Single-load trips: vrId/load_id may equal bare tour id with no legs row yet
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
