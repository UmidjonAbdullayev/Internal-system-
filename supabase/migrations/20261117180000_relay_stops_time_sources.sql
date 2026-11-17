-- Stop time display locals + Relay actualTimeSource columns.
-- Arrival/departure times themselves already exist; mapper was dropping ISO strings.

alter table public.relay_stops
  add column if not exists scheduled_departure_local text,
  add column if not exists actual_departure_local text,
  add column if not exists eta_local text,
  add column if not exists arrival_time_source text,
  add column if not exists departure_time_source text;
