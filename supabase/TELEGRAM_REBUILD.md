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

1. Dry-run → `dry_run_alerts` + CRM `/alert-preview`  
2. `/test` in one linked group  
3. User enables per-group `driver_groups.alerts_enabled`, then env  

## Schema

Migration `20261118160000_telegram_alerts_rebuild.sql`:
`dry_run_alerts`, `bot_users`, `telegram_bot_config`, `driver_groups` columns, alerts_sent unique without level.
