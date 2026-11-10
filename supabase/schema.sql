-- Internal Sys — Fleet Operations CRM
-- Supabase / Postgres schema prepared for future backend connection.
-- Relationships and unique IDs mirror the in-app TypeScript models.

create extension if not exists "pgcrypto";

-- users
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  role text not null check (role in ('Owner', 'Dispatcher', 'Fleet Manager', 'Accounting')),
  company_name text not null,
  created_at timestamptz not null default now()
);

-- drivers
create table if not exists drivers (
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- loads
create table if not exists loads (
  id uuid primary key default gen_random_uuid(),
  load_id text unique not null,
  amazon_ref_id text,
  driver_id uuid references drivers(id) on delete set null,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loads_driver_id_idx on loads(driver_id);
create index if not exists loads_delivery_date_idx on loads(delivery_date);
create index if not exists loads_load_status_idx on loads(load_status);

-- driver_fees (recurring fee configurations per driver)
create table if not exists driver_fees (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id) on delete cascade,
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

create index if not exists driver_fees_driver_id_idx on driver_fees(driver_id);

-- one_time_charges
create table if not exists one_time_charges (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null,
  charge_date date not null,
  settlement_week_start date not null,
  category text not null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists otc_driver_week_idx on one_time_charges(driver_id, settlement_week_start);

-- settlements (weekly paychecks with fee snapshots)
create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  weekly_gross numeric(12,2) not null default 0,
  total_deductions numeric(12,2) not null default 0,
  net_payable numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  status text not null,
  payment_date date,
  finalized boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, week_start)
);

create index if not exists settlements_week_idx on settlements(week_start);

-- settlement_loads (which loads were included in a settlement)
create table if not exists settlement_loads (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references settlements(id) on delete cascade,
  load_id uuid not null references loads(id) on delete restrict,
  unique (settlement_id, load_id)
);

-- settlement_charges (frozen fee snapshots at calculation time)
create table if not exists settlement_charges (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references settlements(id) on delete cascade,
  charge_name text not null,
  category text not null,
  calculation_type text not null,
  original_amount_or_rate numeric(12,2) not null,
  applied_amount numeric(12,2) not null,
  frequency text not null,
  charge_type text not null check (charge_type in ('Recurring', 'One-Time', 'Adjustment')),
  source_id text
);

-- payments (partial/full payments against a settlement)
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references settlements(id) on delete cascade,
  payment_date date not null,
  method text not null,
  reference_id text,
  amount numeric(12,2) not null,
  notes text,
  created_at timestamptz not null default now()
);

-- activity_logs
create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  action text not null,
  description text not null,
  entity_id text,
  user_name text,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_created_idx on activity_logs(created_at desc);
