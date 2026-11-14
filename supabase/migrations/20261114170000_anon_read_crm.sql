-- Allow website/extension anon key to SELECT CRM data for display.
-- Writes stay on Edge Functions (service role).

create policy anon_read_drivers on public.drivers for select to anon using (true);
create policy anon_read_loads on public.loads for select to anon using (true);
create policy anon_read_payments on public.payments for select to anon using (true);
create policy anon_read_settlements on public.settlements for select to anon using (true);
create policy anon_read_settlement_loads on public.settlement_loads for select to anon using (true);
create policy anon_read_settlement_charges on public.settlement_charges for select to anon using (true);
create policy anon_read_driver_fees on public.driver_fees for select to anon using (true);
create policy anon_read_one_time_charges on public.one_time_charges for select to anon using (true);
create policy anon_read_activity_logs on public.activity_logs for select to anon using (true);
create policy anon_read_relay_sync_runs on public.relay_sync_runs for select to anon using (true);
