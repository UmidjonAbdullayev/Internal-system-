# Amazon Relay → Internal Sys Chrome Extension (MV3)

Syncs **CRM-required** Amazon Relay fields into the Internal Sys fleet schema (`internal_sys` on Supabase) via Edge Functions.

## Supabase target

`https://iiyqkdjwxlnfqvlidbqr.supabase.co` (Internal system). Not the CDL Score project.

Full Dashboard setup (SQL → secrets → deploy → GO LIVE): see project store `docs/relay-extension.md`.

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
6. Open Relay **Trips** (Upcoming / In Transit / History) plus **Payments**. Checklist updates as pages are detected. **v1.3.0** soft sync: keep using Relay while sync runs (popup progress; typical full pass **45–90s**). History walks **This week / Last week** (or Last 14 days) filters. Trips scan ~every 4–6 min with jitter; Payments on a longer cadence (~20–30 min). Delivery dates no longer invent Dec 31 / year-2044 junk. **v1.2.x** auto-expand + `T-…` upserts still apply.
7. After updating this folder: `chrome://extensions` → **Reload** on Internal Sys — Amazon Relay Sync → refresh any open Relay tabs → **GO LIVE** (or Force scan).

## v1.3.6 notes

- **Safe two-level expand**: parent `T-…` rows open via a dedicated toggle only; internal legs open via the **blue chevron** beside the shipment id. Whole-row clicks are gone (they opened **Available drivers** / Assign Driver in 1.3.5). Skip when the control is unclear; never click driver links or Assign Driver dropdowns.
- Sync / upsert paths unchanged — reload the unpacked extension after pull.

## v1.3.1 notes

- **Near-live Trips**: on Upcoming / In Transit, DOM + network hooks debounce an incremental sync (seconds), without waiting for the 4–6 min soft alarm. History + Payments stay on the slower cadence.
- **Unstick busy**: separate Trips vs Payments locks, hard timeouts on collect/flush, in-memory mutex + stale recovery so a hung Payments scrape cannot freeze Trips forever.
- **Active vs History**: completed/cancelled loads always map to History; a full Upcoming+In Transit soft pass reconciles CRM so leftover “active” rows drop to History when they leave Relay’s active set.
- **History skip**: already-synced History trips are skipped (no re-expand / re-upsert) unless status or pay changed.

## Security

- No Supabase service-role key in the extension
- No Telegram bot token in the extension
- Extension authenticates to Edge Functions with `X-Relay-Extension-Key`
- Collection is limited to **visible page content** on tabs you open
