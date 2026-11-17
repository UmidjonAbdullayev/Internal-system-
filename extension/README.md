# Amazon Relay → Internal Sys Chrome Extension (MV3)

## Method (v1.5.0) — always-on entitiesV2

Captures and **schedules** `POST /api/tours/entitiesV2` for `IN_TRANSIT` / `UPCOMING` / `HISTORY` without opening section tabs or clicking rows.

1. Passive capture seeds a request **template** (body + headers, no cookies).
2. Always-on keeps a pinned inactive Relay tab; MAIN-world fetch replays the template.
3. Schedules (mins enforced): In Transit 45s, Upcoming 90s, History full backfill then page1/10min.
4. Change detection → immediate CRM flush. Badge: green = in-transit count; `!` = log in to Relay.

## Load / verify

1. Load unpacked `extension/` → version **1.5.0** → refresh Relay tabs
2. Popup login → API key → **GO LIVE**
3. Console: MAIN `entitiesV2 hooks installed` / SW `[RelayCapture] tab=IN_TRANSIT pages=N trips=N new=N changed=N removed=N`
