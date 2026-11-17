# Trip alerts — planned file + DB changes (commit before code)

Do not rebuild the Telegram bot. Add alert pipeline only.

## Database — migration `20261117110000_telegram_trip_alerts`

- `public.telegram_alert_config` — singleton (`default_chat_id`, `bootstrapped`, `sync_stale_notified`, `cron_secret`, `crm_base_url`, `timezone`)
- `public.telegram_alert_settings` — `alert_type` → `chat_id`, `enabled`, quiet hours; seed all types enabled
- `public.alerts_sent` — `(trip_id, stop_id, alert_type, level, sent_at, telegram_message_id, chat_id, meta)` + unique dedupe
- `public.telegram_trip_mutes` — mute trip alerts per chat
- `public.loads` — `late_reason`, `late_reason_at`
- `public.relay_stops` — `late_reason`, `late_reason_at`
- Enable `pg_cron` + `pg_net`; cron job `trip-alerts-every-minute`
- RLS on new tables

Alert types: `trip_booked`, `arrived`, `departed`, `delivered`, `cancelled`, `driver_changed`, `no_driver`, `late_reason`, `not_at_stop`, `running_late`, `cpt_risk`, `late_no_reason`, `sync_stopped`, `sync_restored`

## New files

- `supabase/migrations/20261117110000_telegram_trip_alerts.sql`
- `supabase/functions/trip-alerts/index.ts`
- `supabase/functions/trip-alerts/alerts.ts`
- `supabase/functions/trip-alerts/send.ts`

## Modified files

- `supabase/functions/relay-sync/index.ts` — live change → `trip-alerts` status; bootstrap gate
- `supabase/functions/telegram-webhook/index.ts` — group `/late` `/status` `/mute` `/setdispatch`
- `supabase/functions/telegram-webhook/helpers.ts` — command helpers
- `supabase/functions/README.md` — document trip-alerts
- `supabase/schema.sql` — mirror schema
- `supabase/TRIP_ALERTS_PLAN.md` — this list

## Unchanged (preserve)

- `supabase/functions/relay-telegram/index.ts` — driver `facility_arrived` only
- DM menu/auth behavior in `telegram-webhook`

Chat id resolution (never invent): settings → config.default_chat_id → `TELEGRAM_DISPATCH_CHAT_ID` → `TELEGRAM_OPS_CHAT_ID` → `TELEGRAM_CHAT_ID`.
