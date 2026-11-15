-- Ops spreadsheet report rows (Amazon Relay style sheet)
create table if not exists public.load_reports (
  id uuid primary key default gen_random_uuid(),
  load_uuid uuid references public.loads(id) on delete set null,
  broker text not null default 'Amazon',
  trip text not null default '',
  load_ids text not null default '',
  driver_name text not null default '',
  pickup_date date,
  delivery_date date,
  pu_location text not null default '',
  del_location text not null default '',
  mile text not null default '',
  amazon_paid numeric(12,2) not null default 0,
  driver_paid numeric(12,2) not null default 0,
  rpm numeric(12,4) not null default 0,
  comment text not null default '',
  dispatch text not null default '',
  source text not null default 'sync' check (source in ('sync', 'auto', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists load_reports_load_uuid_uidx
  on public.load_reports (load_uuid)
  where load_uuid is not null;

create index if not exists load_reports_pickup_date_idx on public.load_reports (pickup_date);
create index if not exists load_reports_delivery_date_idx on public.load_reports (delivery_date);
create index if not exists load_reports_dispatch_idx on public.load_reports (dispatch);

alter table public.load_reports enable row level security;

do $$ begin
  create policy anon_read_load_reports on public.load_reports for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_insert_load_reports on public.load_reports for insert to anon with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_update_load_reports on public.load_reports for update to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_delete_load_reports on public.load_reports for delete to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy authenticated_read_load_reports on public.load_reports for select to authenticated using (true);
exception when duplicate_object then null; end $$;
