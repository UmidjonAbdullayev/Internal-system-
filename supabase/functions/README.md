# Relay + Telegram Edge Functions (Internal system)

Project ref: `iiyqkdjwxlnfqvlidbqr` → `https://iiyqkdjwxlnfqvlidbqr.supabase.co`

## Functions

| Name | Auth | Purpose |
|------|------|---------|
| `relay-sync` | `X-Relay-Extension-Key` | Upsert CRM loads/payments; emits **facility_arrived** only (no payment Telegram) |
| `relay-telegram` | same | Route **facility-arrival** alerts to the correct driver Telegram group |
| `telegram-webhook` | `TELEGRAM_WEBHOOK_SECRET` | Slash/menu **private DM only** (admin password + DRV gate); groups: `/link` `/unlink` only |
| `telegram-driver-digest` | `X-Relay-Extension-Key` | No-op (digests disabled; facility-arrival-only policy) |

Bot token lives **only** in Edge Function secrets (`TELEGRAM_BOT_TOKEN`). Never in the extension or git.

## Secrets (Dashboard)

| Secret | Required | Purpose |
|--------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot API token |
| `RELAY_EXTENSION_API_KEY` | Yes | Extension + digest caller |
| `TELEGRAM_ADMIN_PASSWORD` | Yes (for DM menus) | Unlocks private-chat slash menus |
| `TELEGRAM_OPS_CHAT_ID` | Optional | Ops alerts |
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
supabase functions deploy relay-telegram --no-verify-jwt
supabase functions deploy telegram-webhook --no-verify-jwt
supabase functions deploy telegram-driver-digest --no-verify-jwt
```

Per-driver group setup: project store `docs/telegram-driver-groups.md`.
