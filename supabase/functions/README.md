# Relay + Telegram Edge Functions (Internal system)

Project ref: `iiyqkdjwxlnfqvlidbqr` → `https://iiyqkdjwxlnfqvlidbqr.supabase.co`

## Functions

| Name | Auth | Purpose |
|------|------|---------|
| `relay-sync` | `X-Relay-Extension-Key` | Upsert CRM loads/payments; emits driver/trailer notifications |
| `relay-telegram` | same | Route alerts to the correct **driver Telegram group** |
| `telegram-webhook` | `TELEGRAM_WEBHOOK_SECRET` | `/link DRV-xxxx`, `/status`, group activity |
| `telegram-driver-digest` | `X-Relay-Extension-Key` | ~2h per-group status digests |

Bot token lives **only** in Edge Function secrets (`TELEGRAM_BOT_TOKEN`). Never in the extension or git.

## Secrets (Dashboard)

`TELEGRAM_BOT_TOKEN`, `RELAY_EXTENSION_API_KEY`, optional `TELEGRAM_OPS_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`.

## Deploy

```bash
supabase link --project-ref iiyqkdjwxlnfqvlidbqr
supabase functions deploy relay-sync --no-verify-jwt
supabase functions deploy relay-telegram --no-verify-jwt
supabase functions deploy telegram-webhook --no-verify-jwt
supabase functions deploy telegram-driver-digest --no-verify-jwt
```

Per-driver group setup: project store `docs/telegram-driver-groups.md`.
