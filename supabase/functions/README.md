# Relay Edge Functions (Internal system)

Project ref: `iiyqkdjwxlnfqvlidbqr` → `https://iiyqkdjwxlnfqvlidbqr.supabase.co`

## Functions

| Name | Auth | Purpose |
|------|------|---------|
| `relay-sync` | `X-Relay-Extension-Key` = `RELAY_EXTENSION_API_KEY` | Upsert CRM loads/payments |
| `relay-telegram` | same | Deduped Telegram for status/payment/sync/missing-page events |

Bot token lives **only** in Edge Function secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).

## Deploy

```bash
supabase link --project-ref iiyqkdjwxlnfqvlidbqr
supabase secrets set RELAY_EXTENSION_API_KEY="..."
supabase secrets set TELEGRAM_BOT_TOKEN="..."
supabase secrets set TELEGRAM_CHAT_ID="..."
supabase functions deploy relay-sync --no-verify-jwt
supabase functions deploy relay-telegram --no-verify-jwt
```

See project store doc `docs/relay-extension.md` for the full Dashboard path.
