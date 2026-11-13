# Amazon Relay → Internal Sys Chrome Extension (MV3)

Syncs **CRM-required** Amazon Relay fields into the Internal Sys fleet schema (`internal_sys` on Supabase) via Edge Functions.

## Supabase target

`https://iiyqkdjwxlnfqvlidbqr.supabase.co` (Internal system). Not the CDL Score project.

Set `SUPABASE_ANON_KEY` in `shared/config.js` from that project's Settings → API (anon/publishable key only).

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this `extension/` folder
4. Pin **Internal Sys — Amazon Relay Sync**

## Use

1. Sign in to Amazon Relay in Chrome (carrier session stays in the browser — the extension never stores Relay passwords/cookies)
2. Open the extension popup
3. Login: username `admin` / password `qwerty`
4. Paste `RELAY_EXTENSION_API_KEY` (must match the Supabase Edge Function secret)
5. Click **GO LIVE**
6. Open required Relay pages (Tours/My Loads + Payments). The checklist updates as pages are detected and data is written.

## Security

- No Supabase service-role key in the extension
- No Telegram bot token in the extension
- Extension authenticates to Edge Functions with `X-Relay-Extension-Key`
- Collection is limited to **visible page content** on tabs you open
