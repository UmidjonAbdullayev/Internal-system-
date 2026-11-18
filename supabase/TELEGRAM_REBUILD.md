# Telegram alerts rebuild (IS-55)

Existing bot `@inter_sysbot` — not rebuilt.  
**`TELEGRAM_ALERTS_ENABLED` stays OFF** until step 6 review + user approval.

## Alert types (only)

1. **arrived** — live CHECKIN `actualTime` edge between consecutive syncs  
2. **not_at_stop** — once per stop, +15m, next stop, &lt;6h, fresh In Transit sync  

## Kill switch

Every alert Bot API call goes through `trip-alerts/send.ts` → `sendTelegram()`.  
Unset / false env → OFF. DB `telegram_alert_config.alerts_enabled` also false.  
`/test` may force samples; does **not** enable the switch.

## Rollout

1. Dry-run → `dry_run_alerts` + CRM `/alert-preview` (**never seed prod**)  
2. `/test` in one linked group  
3. User enables per-group `driver_groups.alerts_enabled`, then env  

## Dry-run rules

- `action=dry_run` clears table then rebuilds from live 1h window  
- Unique `(trip_id, stop_id, alert_type, chat_id)` — max 1 per linked group (team = 1 per driver group)  
- Cron/status while kill switch OFF do **not** write dry_run rows  

## Schema

Migrations:
- `20261118160000_telegram_alerts_rebuild.sql`
- `20261118170000_dry_run_alerts_dedupe.sql`
