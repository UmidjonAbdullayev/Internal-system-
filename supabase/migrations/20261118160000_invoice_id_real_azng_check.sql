-- Enforce real Relay settlement IDs only (AZNG + 32 hex, no dashes).
-- Blocks FIXTURE-*, AZNG-SMOKE-*, and any other non-canonical invoice_id.
-- Applied after deleting live AZNG-SMOKE-* acceptance seeds (IS-54).

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_invoice_id_real_azng_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_id_real_azng_check
  CHECK (invoice_id ~ '^AZNG[0-9A-F]{32}$');

COMMENT ON CONSTRAINT invoices_invoice_id_real_azng_check ON public.invoices IS
  'Relay settlement IDs only: AZNG + 32 uppercase hex. No dashes, SMOKE, or FIXTURE.';

ALTER TABLE public.invoice_trips
  DROP CONSTRAINT IF EXISTS invoice_trips_invoice_id_real_azng_check;

ALTER TABLE public.invoice_trips
  ADD CONSTRAINT invoice_trips_invoice_id_real_azng_check
  CHECK (invoice_id ~ '^AZNG[0-9A-F]{32}$');

COMMENT ON CONSTRAINT invoice_trips_invoice_id_real_azng_check ON public.invoice_trips IS
  'Must reference a real AZNG invoice_id (AZNG + 32 hex).';
