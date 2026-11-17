# Amazon Relay → Internal Sys Chrome Extension (MV3)

## v1.7.0 — live mirrors + catch-up + retention

- Upcoming / In Transit = complete section snapshots only
- After pause (>5m): reconnect shows **Syncing with Relay…**, then HISTORY catch-up (2s pages) for missing live trips
- `sync_state.last_successful_sync_at` updated on successful snapshots
- Raw captures ring buffer **≤20**
- Popup: Syncing / Catch-up phases

## v1.6.0 — snapshot accuracy (stacked on always-on 1.5.0)

- Always-on `entitiesV2` for IN_TRANSIT / UPCOMING / HISTORY
- CRM: UPSERT `relay_trips` by `trip_id` (= entity.id); legs/stops separate
- After full section pagination: snapshot `{ section, tripIds, totalRecords }` when unique count matches
- Popup: **Relay: N | CRM: N** (red if mismatch)

## Verify (1.7.0)

1. Load unpacked **1.7.0** → GO LIVE
2. Live tabs match Relay counts; `sync_state` updates
3. Stop >5 min → CRM empty + paused; Show last known greyed
4. Reconnect → Syncing… then catch-up; one Telegram restore summary
5. Raw captures download length ≤ 20
