-- Internal Sys — Fleet Operations CRM
-- Target project: https://iiyqkdjwxlnfqvlidbqr.supabase.co (empty Internal system DB)
-- Applied in public schema (no CDL Score collision on this project).

create extension if not exists "pgcrypto";

-- users
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  role text not null check (role in ('Owner', 'Dispatcher', 'Fleet Manager', 'Accounting')),
  company_name text not null,
  created_at timestamptz not null default now()
);

-- drivers
create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  driver_id text unique not null,
  first_name text not null,
  last_name text not null,
  phone text,
  email text,
  status text not null,
  assigned_truck text,
  trailer_id text,
  hire_date date,
  notes text,
  address text,
  city text,
  state text,
  zip text,
  license_number text,
  license_expiry date,
  last_observed timestamptz,
  last_changed timestamptz,
  last_synchronized timestamptz,
  content_hash text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- loads
create table if not exists public.loads (
  id uuid primary key default gen_random_uuid(),
  load_id text unique not null,
  amazon_ref_id text,
  driver_id uuid references public.drivers(id) on delete set null,
  driver_name_raw text,
  load_status text not null,
  payment_status text not null,
  pickup_location text not null,
  delivery_location text not null,
  pickup_date date not null,
  delivery_date date not null,
  trailer_id text,
  trailer_type text,
  distance_miles numeric(10,1) default 0,
  rate_gross numeric(12,2) not null default 0,
  additional_charges numeric(12,2) not null default 0,
  payment_date date,
  notes text,
  status_history jsonb not null default '[]'::jsonb,
  last_observed timestamptz,
  last_changed timestamptz,
  last_synchronized timestamptz,
  content_hash text,
  source text not null default 'amazon_relay',
  is_stale boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loads_driver_id_idx on public.loads(driver_id);
create index if not exists loads_delivery_date_idx on public.loads(delivery_date);
create index if not exists loads_load_status_idx on public.loads(load_status);
create index if not exists loads_amazon_ref_idx on public.loads(amazon_ref_id);
create index if not exists loads_last_observed_idx on public.loads(last_observed);

-- driver_fees
create table if not exists public.driver_fees (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  fee_name text not null,
  category text not null,
  calculation_type text not null check (calculation_type in ('Fixed', 'Percentage')),
  amount numeric(12,2) not null,
  frequency text not null check (frequency in ('Per Load', 'Daily', 'Weekly', 'Monthly')),
  active boolean not null default true,
  start_date date not null,
  end_date date,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists driver_fees_driver_id_idx on public.driver_fees(driver_id);

-- one_time_charges
create table if not exists public.one_time_charges (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null,
  charge_date date not null,
  settlement_week_start date not null,
  category text not null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists otc_driver_week_idx on public.one_time_charges(driver_id, settlement_week_start);

-- settlements
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  weekly_gross numeric(12,2) not null default 0,
  total_deductions numeric(12,2) not null default 0,
  net_payable numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  status text not null,
  payment_date date,
  finalized boolean not null default false,
  last_observed timestamptz,
  last_changed timestamptz,
  last_synchronized timestamptz,
  content_hash text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, week_start)
);

create index if not exists settlements_week_idx on public.settlements(week_start);

-- settlement_loads
create table if not exists public.settlement_loads (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  load_id uuid not null references public.loads(id) on delete restrict,
  unique (settlement_id, load_id)
);

-- settlement_charges
create table if not exists public.settlement_charges (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  charge_name text not null,
  category text not null,
  calculation_type text not null,
  original_amount_or_rate numeric(12,2) not null,
  applied_amount numeric(12,2) not null,
  frequency text not null,
  charge_type text not null check (charge_type in ('Recurring', 'One-Time', 'Adjustment')),
  source_id text
);

-- payments (settlement_id nullable so Relay rows can land before CRM settlement linkage)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid references public.settlements(id) on delete cascade,
  load_id uuid references public.loads(id) on delete set null,
  payment_date date not null,
  method text not null,
  reference_id text,
  amount numeric(12,2) not null,
  notes text,
  amazon_ref_id text,
  last_observed timestamptz,
  last_changed timestamptz,
  last_synchronized timestamptz,
  content_hash text,
  source text not null default 'amazon_relay',
  created_at timestamptz not null default now()
);

create unique index if not exists payments_relay_ref_uidx
  on public.payments (reference_id)
  where reference_id is not null;

-- activity_logs
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  action text not null,
  description text not null,
  entity_id text,
  user_name text,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_created_idx on public.activity_logs(created_at desc);

-- Relay extension bookkeeping
create table if not exists public.relay_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  records_collected int not null default 0,
  records_updated int not null default 0,
  records_inserted int not null default 0,
  error_count int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  section_states jsonb not null default '{}'::jsonb,
  client_id text
);

create table if not exists public.relay_notification_dedupe (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  event_type text not null,
  payload_summary text,
  created_at timestamptz not null default now()
);

create index if not exists relay_notif_dedupe_created_idx
  on public.relay_notification_dedupe(created_at desc);

-- RLS: extension writes via Edge Functions (service role); authenticated CRM can read
alter table public.users enable row level security;
alter table public.drivers enable row level security;
alter table public.loads enable row level security;
alter table public.driver_fees enable row level security;
alter table public.one_time_charges enable row level security;
alter table public.settlements enable row level security;
alter table public.settlement_loads enable row level security;
alter table public.settlement_charges enable row level security;
alter table public.payments enable row level security;
alter table public.activity_logs enable row level security;
alter table public.relay_sync_runs enable row level security;
alter table public.relay_notification_dedupe enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='loads' and policyname='authenticated_read_loads') then
    create policy authenticated_read_loads on public.loads for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='drivers' and policyname='authenticated_read_drivers') then
    create policy authenticated_read_drivers on public.drivers for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='payments' and policyname='authenticated_read_payments') then
    create policy authenticated_read_payments on public.payments for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='settlements' and policyname='authenticated_read_settlements') then
    create policy authenticated_read_settlements on public.settlements for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='activity_logs' and policyname='authenticated_read_activity') then
    create policy authenticated_read_activity on public.activity_logs for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='relay_sync_runs' and policyname='authenticated_read_sync_runs') then
    create policy authenticated_read_sync_runs on public.relay_sync_runs for select to authenticated using (true);
  end if;
end$$;
