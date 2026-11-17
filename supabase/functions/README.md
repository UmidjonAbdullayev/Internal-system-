# Relay + Telegram Edge Functions (Internal system)

Project ref: `iiyqkdjwxlnfqvlidbqr` → `https://iiyqkdjwxlnfqvlidbqr.supabase.co`

## Functions

| Name | Auth | Purpose |
|------|------|---------|
| `relay-sync` | `X-Relay-Extension-Key` | Upsert CRM loads/trips/stops; emits **facility_arrived** (driver groups) + queues **dispatch trip-alerts** on live changes |
| `relay-snapshot` | same | Trip/leg/stop UPSERT + section snapshots; `sync_state`; HISTORY catch-up + one `sync_restored` summary |
| `relay-retention` | same | Manual trigger for `run_relay_retention()` (pg_cron also 03:00) |
| `relay-telegram` | same | Route **facility-arrival** alerts to the correct driver Telegram group |
| `trip-alerts` | cron secret / extension key / service role | Dispatch-group status + 1-min time alerts; `action=status\|cron\|test\|bootstrap\|diagnose` |
| `telegram-webhook` | `TELEGRAM_WEBHOOK_SECRET` | DM slash/menu (admin password + DRV); groups: `/link` `/unlink` + `/late` `/status <tripId>` `/mute` `/setdispatch` |
| `telegram-driver-digest` | `X-Relay-Extension-Key` | No-op (digests disabled; facility-arrival-only policy) |

Bot token lives **only** in Edge Function secrets (`TELEGRAM_BOT_TOKEN`). Never in the extension or git.

## Trip alerts (dispatch)

- Settings: `telegram_alert_settings` + `telegram_alert_config.default_chat_id`
- Chat resolve (never invent): settings → config → `TELEGRAM_DISPATCH_CHAT_ID` → `TELEGRAM_OPS_CHAT_ID` → `TELEGRAM_CHAT_ID`
- Dedupe: `alerts_sent` unique `(trip_id, stop_id, alert_type, level)`
- Cron: `pg_cron` job `trip-alerts-every-minute` → `POST …/trip-alerts?cron_secret=…`
- Pin dispatch group in Telegram: `/setdispatch` inside that group
- HTML style: bold trip id, 1 emoji, max 3 lines, inline Open in CRM

## Secrets (Dashboard)

| Secret | Required | Purpose |
|--------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot API token |
| `RELAY_EXTENSION_API_KEY` | Yes | Extension + digest caller |
| `TELEGRAM_ADMIN_PASSWORD` | Yes (for DM menus) | Unlocks private-chat slash menus |
| `TELEGRAM_DISPATCH_CHAT_ID` | Optional | Preferred dispatch alert chat |
| `TELEGRAM_OPS_CHAT_ID` | Optional | Ops / fallback dispatch chat |
| `TELEGRAM_CHAT_ID` | Optional | Legacy fallback chat |
| `TELEGRAM_WEBHOOK_SECRET` | Optional | Webhook `secret_token` |

MCP has no secret-setter; Management API needs `SUPABASE_ACCESS_TOKEN` (not available in the agent VM).

## Webhook

Registered for `@inter_sysbot`:

`https://iiyqkdjwxlnfqvlidbqr.supabase.co/functions/v1/telegram-webhook`

Inbound updates work after `TELEGRAM_BOT_TOKEN` is set. Optional `TELEGRAM_WEBHOOK_SECRET` requires a matching `setWebhook` `secret_token`.

## Deploy

```bash
supabase link --project-ref iiyqkdjwxlnfqvlidbqr
supabase functions deploy relay-sync --no-verify-jwt
supabase functions deploy relay-snapshot --no-verify-jwt
supabase functions deploy relay-retention --no-verify-jwt
supabase functions deploy relay-telegram --no-verify-jwt
supabase functions deploy trip-alerts --no-verify-jwt
supabase functions deploy telegram-webhook --no-verify-jwt
supabase functions deploy telegram-driver-digest --no-verify-jwt
```

### Live mirrors / retention

- `sync_state` + `relay_catch_up.gap_*` — trip-alerts must skip overdue for events inside a resolved gap.
- Daily cron `relay-retention-0300` → `SELECT public.run_relay_retention();` (summarize HISTORY → `trip_summaries`, then delete detail).

Per-driver group setup: project store `docs/telegram-driver-groups.md`.  
Trip-alerts plan: `supabase/TRIP_ALERTS_PLAN.md`.
