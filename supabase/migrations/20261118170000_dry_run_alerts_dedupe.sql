-- Dry-run dedupe: at most one row per trip/stop/type/chat. Never seed prod.
-- Cron must not write dry_run while kill switch OFF (enforced in trip-alerts code).

create unique index if not exists dry_run_alerts_dedupe_uidx
  on public.dry_run_alerts (trip_id, stop_id, alert_type, (coalesce(chat_id, '')));

comment on index public.dry_run_alerts_dedupe_uidx is
  'One dry-run preview row per stop per linked chat (null chat = unlinked candidate).';
