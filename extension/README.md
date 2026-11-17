# Amazon Relay → Internal Sys Chrome Extension (MV3)

## v1.6.0 — snapshot accuracy (stacked on always-on 1.5.0)

- Always-on `entitiesV2` for IN_TRANSIT / UPCOMING / HISTORY
- CRM: UPSERT `relay_trips` by `trip_id` (= entity.id); legs/stops separate
- After full section pagination: snapshot `{ section, tripIds, totalRecords }` when unique count matches
- Popup: **Relay: N | CRM: N** (red if mismatch)

## Verify

1. Load unpacked **1.6.0** → GO LIVE
2. SW: `[RelayCapture] tab=IN_TRANSIT pages=N trips=N new=N changed=N removed=N`
3. Popup section rows show Relay vs CRM counts
4. On mismatch / skip: `snapshot SKIP … unique tripIds=… != totalRecords=…`
