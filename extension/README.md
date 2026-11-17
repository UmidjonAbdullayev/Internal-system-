# Amazon Relay → Internal Sys Chrome Extension (MV3)

## v1.8.2 — stop times from actions[]

- `epochToIsoUtc` accepts ISO-8601 strings (Relay CHECKIN/CHECKOUT `plannedTime`/`actualTime`) as well as epochs
- Maps arrival/departure/ETA/late reason/`actualTimeSource` from `stop.actions[]`
- Popup **Force re-sync** ignores version/hash and re-pushes Upcoming + In Transit + History backfill
- Does **not** enable Telegram (`TELEGRAM_ALERTS_ENABLED` stays OFF)

## v1.8.0 — per-tab entitiesV2 templates

- Each tab (UPCOMING / IN_TRANSIT / HISTORY) uses its **own full filter body**
- Never builds one tab from another by swapping `tileCountTab`
- Live capture → `chrome.storage.local` per tab; built-in fallbacks for HISTORY + UPCOMING
- IN_TRANSIT: no fallback — navigate sync tab to Relay In Transit once to capture
- Refresh "now" timestamps before every request; HISTORY 7-day windows + 45-day backfill
- UPCOMING relative window (today−17d → today+6m, Asia/Tashkent)
- Section assignment = responding tab; UPCOMING∩IN_TRANSIT overlap → template-wrong, no CRM overwrite
- Seam: `buildRequestBody(tileCountTab, opts)` in `background/always-on-sync.js`

## v1.7.0 — live mirrors + catch-up + retention

- Upcoming / In Transit = complete section snapshots only
- After pause (>5m): reconnect shows **Syncing with Relay…**, then HISTORY catch-up
- Raw captures ring buffer **≤20**

## Verify (1.8.0)

1. Load unpacked **1.8.0** → GO LIVE
2. Popup shows per-tab template source (`live capture HH:MM` or `fallback`)
3. UPCOMING trips match Upcoming visibility filters (not In Transit)
4. Missing IN_TRANSIT template → auto-nav to `/tours/in-transit` once
5. HISTORY backfill progress e.g. `Week 3/7 · N trips`
