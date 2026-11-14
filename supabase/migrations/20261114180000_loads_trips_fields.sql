-- Trips CRM fields for Relay Upcoming / In Transit / History
alter table public.loads
  add column if not exists tractor_id text,
  add column if not exists parent_trip_id text,
  add column if not exists trip_bucket text check (trip_bucket is null or trip_bucket in ('upcoming','in_transit','history')),
  add column if not exists status_bar_state text,
  add column if not exists status_stop_index integer,
  add column if not exists job_type text;

create index if not exists loads_trip_bucket_idx on public.loads(trip_bucket);
create index if not exists loads_parent_trip_idx on public.loads(parent_trip_id);
create index if not exists loads_tractor_idx on public.loads(tractor_id);

-- Website (anon) write paths for driver/fee/charge imports
do $$ begin
  create policy anon_insert_drivers on public.drivers for insert to anon with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_update_drivers on public.drivers for update to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_insert_driver_fees on public.driver_fees for insert to anon with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_update_driver_fees on public.driver_fees for update to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_insert_one_time_charges on public.one_time_charges for insert to anon with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_update_one_time_charges on public.one_time_charges for update to anon using (true) with check (true);
exception when duplicate_object then null; end $$;
