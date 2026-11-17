# Amazon Relay → Internal Sys Chrome Extension (MV3)

Syncs **CRM-required** Amazon Relay fields into the Internal Sys fleet schema (`internal_sys` on Supabase) via Edge Functions.

## Method (v1.4.0)

**Passive JSON API capture** — no DOM scraping, no row expand clicks, no MutationObserver on the Trips table.

1. **MAIN world** `content/injected.js` wraps `fetch` + `XMLHttpRequest` and `postMessage`s JSON bodies.
2. **Isolated** `content/content.js` bridges to the service worker.
3. **Background** stores the last 200 raw captures, recursively extracts trips/legs/stops, dedupes by hash, and flushes to `relay-sync` (same CRM payload shape as before).

## Supabase target

`https://iiyqkdjwxlnfqvlidbqr.supabase.co` (Internal system). Not the CDL Score project.

Set `SUPABASE_ANON_KEY` in `shared/config.js` from that project's Settings → API (anon/publishable key only).

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this `extension/` folder
4. Pin **Internal Sys — Amazon Relay Sync**
5. After updates: **Reload** the extension → refresh open Relay tabs

## Use

1. Sign in to Amazon Relay in Chrome (carrier session stays in the browser)
2. Open the extension popup → login `admin` / `qwerty`
3. Paste `RELAY_EXTENSION_API_KEY` → **GO LIVE**
4. Open Relay **Trips** (Upcoming / In Transit / History) and use the site normally — the extension captures JSON as Relay loads it
5. Optional: extension **Options** → **Download raw captures** (last 200 JSON responses)
6. **Flush now** forces a CRM flush of pending extracted trips

## Verify (DevTools)

On a Relay Trips tab:

| Context | Expected console line |
|---------|------------------------|
| Page (MAIN) | `[RelayCapture MAIN] fetch/XHR hooks installed` then `[RelayCapture MAIN] captured JSON …` |
| Content script (isolated) | `[RelayCapture bridge] listening…` / `forwarded …` |
| Service worker | `[RelayCapture SW] captured URL …` / `extractTrips → N trip(s)…` |

Open `chrome://extensions` → service worker **Inspect** for SW logs.

## Security

- No Supabase service-role key in the extension
- No Telegram bot token in the extension
- Extension authenticates to Edge Functions with `X-Relay-Extension-Key`
- Capture is limited to JSON responses on Relay tabs you open; hooks never alter page behavior
