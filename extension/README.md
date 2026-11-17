# Amazon Relay → Internal Sys Chrome Extension (MV3)

Syncs CRM-required Amazon Relay fields into Internal Sys via Edge `relay-sync`.

## Method (v1.4.1)

**Passive capture of one confirmed API:**

`POST https://relay.amazon.com/api/tours/entitiesV2`

- Request body includes `tileCountTab` (`IN_TRANSIT` / `UPCOMING` / `HISTORY`) and `pagination`
- Response `{ entities: [...], totalRecords, nextToken, ... }` has all trip/leg/stop data — **no row expansion**

Pipeline: MAIN `injected.js` (fetch + XHR) → isolated `content.js` → service worker exact field map → CRM flush.

Optional (default **off**): Options → **Sync all History** paginates `tileCountTab=HISTORY` with `from += 100`, ≤1 req / 2s.

## Load in Chrome

1. `chrome://extensions` → Developer mode → **Load unpacked** → `extension/`
2. Reload extension after updates → **refresh every open Relay tab**
3. Popup: `admin` / `qwerty` → paste `RELAY_EXTENSION_API_KEY` → **GO LIVE**
4. Browse Trips Upcoming / In Transit / History normally

## Verify (DevTools)

| Context | Expected |
|---------|----------|
| **MAIN** (page console) | `[RelayCapture MAIN] entitiesV2 hooks installed` then `entitiesV2 captured IN_TRANSIT` (or UPCOMING / HISTORY) |
| **Bridge** (content) | `[RelayCapture bridge] listening for entitiesV2 captures` / `forwarded entitiesV2 <tab>` |
| **Service worker** Inspect | `[RelayCapture] tab=IN_TRANSIT trips=N legs=N stops=N` |

Options → **Download raw captures** (last 20; phone/email stripped).

## Security

- No service-role key / Telegram token in the extension
- Edge auth via `X-Relay-Extension-Key`
- Driver **firstName/lastName only** — never phone/email in storage or CRM payload
