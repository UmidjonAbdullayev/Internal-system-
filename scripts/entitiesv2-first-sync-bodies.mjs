/**
 * Harness: build exact first-sync entitiesV2 request bodies per tab
 * without live Relay (uses built-in fallbacks + window/now refresh).
 *
 * Usage: node scripts/entitiesv2-first-sync-bodies.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const templatesPath = join(root, 'extension/shared/templates.js');

// Load templates.js as text and eval exports via dynamic import (ESM)
const {
  buildTabRequestBody,
  fallbackTemplate,
  FALLBACK_CAPTURED_AT,
  listHistoryBackfillWindows,
  historyWindowContaining,
  upcomingWindow,
  DEFAULT_TIMEZONE,
} = await import(join(root, 'extension/shared/templates.js'));

const NOW = new Date('2026-11-17T14:20:00.000Z');
const TZ = DEFAULT_TIMEZONE;

const out = {
  generatedAt: new Date().toISOString(),
  harnessNow: NOW.toISOString(),
  timezone: TZ,
  notes: {
    IN_TRANSIT:
      'No built-in fallback. Capture path: ensureInTransitCapture → chrome.tabs.update(RELAY_IN_TRANSIT_URL) then saveTabRequestTemplate on entitiesV2 with tileCountTab=IN_TRANSIT.',
    captureNavUrl: 'https://relay.amazon.com/tours/in-transit',
    seam: 'buildRequestBody(tileCountTab, opts) in extension/background/always-on-sync.js',
  },
  windows: {
    HISTORY_first: historyWindowContaining(NOW, TZ),
    HISTORY_backfill: listHistoryBackfillWindows(NOW, TZ).map((w) => ({
      index: w.index,
      label: w.label,
      startISO: w.startISO,
      endISO: w.endISO,
    })),
    UPCOMING: upcomingWindow(NOW, TZ),
  },
  bodies: {},
};

for (const tab of ['UPCOMING', 'HISTORY']) {
  const template = fallbackTemplate(tab);
  const historyWindow = tab === 'HISTORY' ? historyWindowContaining(NOW, TZ) : null;
  const built = buildTabRequestBody(tab, template, {
    from: 0,
    size: 100,
    now: NOW,
    timeZone: TZ,
    historyWindow,
  });
  out.bodies[tab] = {
    templateSource: 'fallback',
    templateCapturedAt: FALLBACK_CAPTURED_AT[tab],
    ok: built.ok,
    body: built.body,
  };
}

out.bodies.IN_TRANSIT = {
  templateSource: null,
  ok: false,
  error: 'no_template',
  needCapture: true,
  capturePath:
    'alwaysOnTick → ensureInTransitCapture(tabId) → navigate https://relay.amazon.com/tours/in-transit → handleCapture/saveTabRequestTemplate(IN_TRANSIT)',
  body: null,
};

const destArg = process.argv[2];
const json = JSON.stringify(out, null, 2);
if (destArg) {
  writeFileSync(destArg, json);
  console.log('Wrote', destArg);
} else {
  console.log(json);
}
