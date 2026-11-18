-- CRM list/filter performance indexes (no money formula changes).
-- Safe / concurrent-friendly: IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS relay_trips_archived_section_last_seen_idx
  ON public.relay_trips (section, last_seen_at DESC)
  WHERE archived = false;

CREATE INDEX IF NOT EXISTS relay_trips_archived_end_time_idx
  ON public.relay_trips (end_time DESC)
  WHERE archived = false AND section = 'HISTORY';

CREATE INDEX IF NOT EXISTS relay_legs_archived_trip_idx
  ON public.relay_legs (trip_id)
  WHERE archived = false;

CREATE INDEX IF NOT EXISTS relay_stops_archived_trip_seq_idx
  ON public.relay_stops (trip_id, seq)
  WHERE archived = false;

CREATE INDEX IF NOT EXISTS payments_load_id_idx
  ON public.payments (load_id);

CREATE INDEX IF NOT EXISTS payments_settlement_id_idx
  ON public.payments (settlement_id);

CREATE INDEX IF NOT EXISTS settlement_loads_settlement_id_idx
  ON public.settlement_loads (settlement_id);

CREATE INDEX IF NOT EXISTS settlement_loads_load_id_idx
  ON public.settlement_loads (load_id);

CREATE INDEX IF NOT EXISTS settlement_charges_settlement_id_idx
  ON public.settlement_charges (settlement_id);
