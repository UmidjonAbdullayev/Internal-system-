/**
 * Always-on entitiesV2 section sync: tab lock, request queue, schedules, change detection.
 */

import {
  DEBUG,
  ENTITIES_V2_URL,
  RELAY_TRIPS_URL,
  PAGE_SIZE,
  MIN_REQUEST_GAP_MS,
  HISTORY_PAGE_GAP_MS,
  LIVE_PAUSE_MS,
  CATCH_UP_LOOKBACK_MS,
  SCHEDULE_MIN,
  SCHEDULE_DEFAULTS,
  SCHEDULE_JITTER_MS,
  SYNC_LOCK_HEARTBEAT_MS,
  SYNC_LOCK_STALE_MS,
  HTTP_BACKOFF_BASE_MS,
  HTTP_BACKOFF_MAX_MS,
  REQUEST_TEMPLATE_KEY,
  SECTION_SNAPSHOT_KEY,
  SYNC_LOCK_KEY,
  LAST_ENTITIES_REQ_KEY,
  ALWAYS_ON_ALARM,
} from '../shared/config.js';
import { getState, setState } from '../shared/state.js';
import { extractTrips, tripContentHashPayload, hashString } from '../shared/extract.js';

const RELAY_HOST_RE = /^https:\/\/([a-z0-9-]+\.)?relay\.amazon\.com\//i;
const TABS = ['IN_TRANSIT', 'UPCOMING', 'HISTORY'];

let requestInFlight = false;
let lastRequestAt = 0;
let httpBackoffMs = HTTP_BACKOFF_BASE_MS;
let tickRunning = false;
let heartbeatTimer = null;

/** Callbacks injected by service-worker */
let hooks = {
  onTripsDiff: async () => {},
  onAuthRequired: async () => {},
  onHealthy: async () => {},
  onBackoff: async () => {},
  onBeginCatchUp: async () => ({ missingTripIds: [], untilIso: null }),
  onFinalizeCatchUp: async () => {},
  log: (...args) => {
    if (DEBUG) console.log('[RelayCapture]', ...args);
  },
};

export function configureAlwaysOn(nextHooks) {
  hooks = { ...hooks, ...nextHooks };
}

function log(...args) {
  hooks.log(...args);
}

function jitter(ms) {
  const j = SCHEDULE_JITTER_MS;
  return Math.max(0, ms + (Math.random() * 2 - 1) * j);
}

export function enforceScheduleMs(raw) {
  return {
    IN_TRANSIT_MS: Math.max(
      SCHEDULE_MIN.IN_TRANSIT_MS,
      Number(raw?.IN_TRANSIT_MS) || SCHEDULE_DEFAULTS.IN_TRANSIT_MS,
    ),
    UPCOMING_MS: Math.max(
      SCHEDULE_MIN.UPCOMING_MS,
      Number(raw?.UPCOMING_MS) || SCHEDULE_DEFAULTS.UPCOMING_MS,
    ),
    HISTORY_PAGE1_MS: Math.max(
      SCHEDULE_MIN.HISTORY_PAGE1_MS,
      Number(raw?.HISTORY_PAGE1_MS) || SCHEDULE_DEFAULTS.HISTORY_PAGE1_MS,
    ),
  };
}

export function stripCookieHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (/^cookie$/i.test(k) || /^set-cookie$/i.test(k)) continue;
    if (v != null) out[k] = String(v);
  }
  return out;
}

export async function saveRequestTemplate(body, headers, meta = {}) {
  if (!body || typeof body !== 'object') return false;
  const template = {
    body: JSON.parse(JSON.stringify(body)),
    headers: stripCookieHeaders(headers || {}),
    url: ENTITIES_V2_URL,
    at: meta.at || new Date().toISOString(),
    pageUrl: meta.pageUrl || null,
  };
  await chrome.storage.local.set({
    [REQUEST_TEMPLATE_KEY]: template,
    [LAST_ENTITIES_REQ_KEY]: template,
  });
  await setState({ hasRequestTemplate: true });
  return true;
}

export async function getRequestTemplate() {
  const stored = await chrome.storage.local.get([REQUEST_TEMPLATE_KEY, LAST_ENTITIES_REQ_KEY]);
  return stored[REQUEST_TEMPLATE_KEY] || stored[LAST_ENTITIES_REQ_KEY] || null;
}

async function getLock() {
  const stored = await chrome.storage.local.get([SYNC_LOCK_KEY]);
  return stored[SYNC_LOCK_KEY] || null;
}

async function setLock(lock) {
  await chrome.storage.local.set({ [SYNC_LOCK_KEY]: lock });
}

export async function releaseSyncLock(ownerId) {
  const lock = await getLock();
  if (lock && lock.ownerId === ownerId) {
    await chrome.storage.local.remove(SYNC_LOCK_KEY);
  }
}

/**
 * Acquire or renew single-tab sync lock. Returns { ok, tabId, ownerId } or { ok:false }.
 */
export async function acquireSyncLock(preferredTabId) {
  const ownerId = (await getState()).clientId || 'sw';
  const now = Date.now();
  const lock = await getLock();
  if (
    lock &&
    lock.ownerId &&
    lock.ownerId !== ownerId &&
    lock.heartbeatAt &&
    now - lock.heartbeatAt < SYNC_LOCK_STALE_MS
  ) {
    // Another owner is fresh — only proceed if same tab is ours to heartbeat later
    if (lock.tabId && preferredTabId && lock.tabId === preferredTabId) {
      // same tab, take over ownership
    } else if (lock.tabId) {
      return { ok: true, tabId: lock.tabId, ownerId: lock.ownerId, foreign: true };
    }
  }
  const tabId = preferredTabId || lock?.tabId || null;
  if (!tabId) return { ok: false };
  const next = { ownerId, tabId, heartbeatAt: now };
  await setLock(next);
  return { ok: true, tabId, ownerId, foreign: false };
}

export async function heartbeatLock(tabId) {
  const ownerId = (await getState()).clientId || 'sw';
  const lock = await getLock();
  if (lock && lock.ownerId !== ownerId && Date.now() - (lock.heartbeatAt || 0) < SYNC_LOCK_STALE_MS) {
    return lock;
  }
  const next = { ownerId, tabId, heartbeatAt: Date.now() };
  await setLock(next);
  return next;
}

export function startHeartbeat(tabId) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    void heartbeatLock(tabId);
  }, SYNC_LOCK_HEARTBEAT_MS);
}

export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Ensure a Relay tab exists (pinned, inactive). Returns tab id.
 */
export async function ensureRelayTab() {
  const tabs = await chrome.tabs.query({});
  const relayTabs = tabs.filter((t) => t.id != null && t.url && RELAY_HOST_RE.test(t.url));
  const state = await getState();

  if (state.alwaysOnTabId) {
    const still = relayTabs.find((t) => t.id === state.alwaysOnTabId);
    if (still) return still.id;
  }

  // Prefer an existing tours/trips tab
  const preferred =
    relayTabs.find((t) => /\/tours?|\/trips?/i.test(t.url || '')) || relayTabs[0];
  if (preferred) {
    try {
      await chrome.tabs.update(preferred.id, { pinned: true, active: false });
    } catch {
      /* ignore */
    }
    await setState({ alwaysOnTabId: preferred.id });
    return preferred.id;
  }

  const created = await chrome.tabs.create({
    url: RELAY_TRIPS_URL,
    pinned: true,
    active: false,
  });
  await setState({ alwaysOnTabId: created.id });
  return created.id;
}

async function waitRequestGap(extraMs = 0) {
  const gap = Math.max(MIN_REQUEST_GAP_MS, extraMs);
  const wait = Math.max(0, gap - (Date.now() - lastRequestAt));
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Single entitiesV2 POST via page MAIN world.
 */
export async function fetchEntitiesPage(tabId, tileCountTab, from, size = PAGE_SIZE) {
  const template = await getRequestTemplate();
  if (!template?.body) {
    return { ok: false, error: 'no_template', authRequired: false };
  }

  await waitRequestGap();
  if (requestInFlight) {
    return { ok: false, error: 'in_flight' };
  }
  requestInFlight = true;
  lastRequestAt = Date.now();

  try {
    const body = {
      ...template.body,
      tileCountTab,
      pagination: {
        ...(template.body.pagination || {}),
        size,
        from,
      },
    };

    let result;
    try {
      result = await chrome.tabs.sendMessage(tabId, {
        type: 'RELAY_FETCH_ENTITIES_V2',
        url: template.url || ENTITIES_V2_URL,
        body,
        headers: template.headers || {},
      });
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }

    if (result?.authRequired || result?.status === 401 || result?.status === 403) {
      await hooks.onAuthRequired(result);
      return { ok: false, authRequired: true, status: result.status, error: result.error };
    }

    if (!result?.ok) {
      const status = result?.status || 0;
      if (status === 429 || status >= 500) {
        await hooks.onBackoff(status, httpBackoffMs);
        httpBackoffMs = Math.min(HTTP_BACKOFF_MAX_MS, httpBackoffMs * 2);
      }
      return { ok: false, status, error: result?.error || 'fetch_failed' };
    }

    httpBackoffMs = HTTP_BACKOFF_BASE_MS;
    await hooks.onHealthy();
    return {
      ok: true,
      data: result.data,
      requestBody: body,
      totalRecords: Number(result.data?.totalRecords) || 0,
      entities: Array.isArray(result.data?.entities) ? result.data.entities : [],
    };
  } finally {
    requestInFlight = false;
    lastRequestAt = Date.now();
  }
}

async function loadSnapshots() {
  const stored = await chrome.storage.local.get([SECTION_SNAPSHOT_KEY]);
  return stored[SECTION_SNAPSHOT_KEY] || {
    IN_TRANSIT: {},
    UPCOMING: {},
    HISTORY: {},
  };
}

async function saveSnapshots(snapshots) {
  await chrome.storage.local.set({ [SECTION_SNAPSHOT_KEY]: snapshots });
}

/**
 * Diff trips against previous section snapshot.
 * Returns { newTrips, changedTrips, removedTripIds, nextSnapshot, stats }
 */
export async function diffSectionTrips(tileCountTab, trips) {
  const snapshots = await loadSnapshots();
  const prev = snapshots[tileCountTab] || {}; // tripId → { version, hash }
  const next = {};
  const newTrips = [];
  const changedTrips = [];
  const changedFieldsMap = {};

  for (const trip of trips) {
    if (!trip?.tripId) continue;
    const payload = tripContentHashPayload(trip);
    const hash = await hashString(payload);
    const version = trip.version ?? null;
    next[trip.tripId] = { version, hash };
    const old = prev[trip.tripId];
    if (!old) {
      newTrips.push(trip);
      continue;
    }
    if (String(old.version) !== String(version) || old.hash !== hash) {
      changedTrips.push(trip);
      changedFieldsMap[trip.tripId] = {
        version: old.version !== version,
        content: old.hash !== hash,
      };
    }
  }

  const removedTripIds = [];
  for (const id of Object.keys(prev)) {
    if (!next[id]) removedTripIds.push(id);
  }

  snapshots[tileCountTab] = next;
  await saveSnapshots(snapshots);

  return {
    newTrips,
    changedTrips,
    removedTripIds,
    changedFieldsMap,
    stats: {
      trips: trips.length,
      newCount: newTrips.length,
      changedCount: changedTrips.length,
      removedCount: removedTripIds.length,
    },
  };
}

/**
 * Fetch all pages for a tab (or HISTORY page1-only / backfill / catch-up).
 * catchUp: page HISTORY newest-first until older than untilIso or all missing found.
 */
export async function syncSection(
  tabId,
  tileCountTab,
  { page1Only = false, catchUp = false, catchUpUntilIso = null, missingTripIds = [] } = {},
) {
  const state = await getState();
  if (state.health?.pausedUntil && Date.parse(state.health.pausedUntil) > Date.now()) {
    return { ok: false, skipped: 'paused' };
  }

  const allTrips = [];
  let pages = 0;
  let from = 0;
  let totalRecords = Infinity;
  const stillMissing = new Set(
    (missingTripIds || []).map((id) => String(id || '').toUpperCase()).filter(Boolean),
  );
  const foundIds = [];
  const untilMs = catchUpUntilIso ? Date.parse(catchUpUntilIso) : null;

  for (;;) {
    if (!(await getState()).live) return { ok: false, skipped: 'stopped' };

    const gap = tileCountTab === 'HISTORY' ? HISTORY_PAGE_GAP_MS : MIN_REQUEST_GAP_MS;
    const page = await fetchEntitiesPage(tabId, tileCountTab, from, PAGE_SIZE);
    if (!page.ok) {
      await setState({
        sectionSync: {
          [tileCountTab]: {
            lastError: page.error || 'fetch failed',
            lastSyncAt: new Date().toISOString(),
          },
        },
      });
      return page;
    }

    pages += 1;
    totalRecords = page.totalRecords || totalRecords;
    const trips = extractTrips(ENTITIES_V2_URL, page.data, page.requestBody);
    allTrips.push(...trips);

    if (catchUp && tileCountTab === 'HISTORY') {
      for (const t of trips) {
        const id = String(t.tripId || '').toUpperCase();
        if (stillMissing.has(id)) {
          stillMissing.delete(id);
          foundIds.push(id);
        }
      }
      const oldestEnd = trips.reduce((min, t) => {
        const ts = Date.parse(t.endTime || t.startTime || '') || Infinity;
        return Math.min(min, ts);
      }, Infinity);
      const pastLookback =
        untilMs != null && Number.isFinite(oldestEnd) && oldestEnd < untilMs && trips.length > 0;
      const got = page.entities.length;
      const done =
        !stillMissing.size || pastLookback || got < PAGE_SIZE || from + PAGE_SIZE >= totalRecords;
      if (done) break;
      from += PAGE_SIZE;
      await waitRequestGap(gap);
      continue;
    }

    const got = page.entities.length;
    if (page1Only) break;
    if (got < PAGE_SIZE) break;
    from += PAGE_SIZE;
    if (from >= totalRecords) break;
    // HISTORY backfill: enforce 2s between pages (waitRequestGap also applies)
    await waitRequestGap(gap);
  }

  const diff = await diffSectionTrips(tileCountTab, allTrips);
  log(
    `tab=${tileCountTab} pages=${pages} trips=${diff.stats.trips} new=${diff.stats.newCount} changed=${diff.stats.changedCount} removed=${diff.stats.removedCount}${
      catchUp ? ` catchUpFound=${foundIds.length} stillMissing=${stillMissing.size}` : ''
    }`,
  );

  await setState({
    sectionSync: {
      [tileCountTab]: {
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        trips: diff.stats.trips,
        pages,
        newCount: diff.stats.newCount,
        changedCount: diff.stats.changedCount,
        removedCount: diff.stats.removedCount,
      },
    },
    lastTripsScanAt: new Date().toISOString(),
  });

  if (tileCountTab === 'IN_TRANSIT') {
    await setState({
      health: { inTransitCount: diff.stats.trips },
    });
  }

  const uniqueIds = [
    ...new Set(allTrips.map((t) => String(t.tripId || '').toUpperCase()).filter(Boolean)),
  ];
  const reportedTotal =
    Number.isFinite(totalRecords) && totalRecords !== Infinity ? Number(totalRecords) : uniqueIds.length;

  // Snapshot only after full pagination (all pages), error-free, counts match — not during catch-up pages
  let snapshot = null;
  if (!page1Only && !catchUp) {
    if (uniqueIds.length !== reportedTotal) {
      log(
        `snapshot SKIP ${tileCountTab}: unique tripIds=${uniqueIds.length} != totalRecords=${reportedTotal}`,
      );
    } else {
      snapshot = {
        section: tileCountTab,
        tripIds: uniqueIds,
        totalRecords: reportedTotal,
        syncedAt: new Date().toISOString(),
      };
    }
  }

  const tripsForPush = catchUp
    ? allTrips.filter((t) => foundIds.includes(String(t.tripId || '').toUpperCase()))
    : allTrips;

  await hooks.onTripsDiff({
    tileCountTab,
    trips: tripsForPush.length ? tripsForPush : allTrips,
    newTrips: diff.newTrips,
    changedTrips: diff.changedTrips,
    removedTripIds: diff.removedTripIds,
    changedFieldsMap: diff.changedFieldsMap,
    pages,
    page1Only: Boolean(page1Only),
    totalRecords: reportedTotal,
    snapshot,
    fetchHadError: false,
    catchUp: Boolean(catchUp),
    catchUpFoundIds: foundIds,
    catchUpStillMissing: [...stillMissing],
  });

  return {
    ok: true,
    pages,
    totalRecords: reportedTotal,
    snapshot,
    catchUpFoundIds: foundIds,
    catchUpStillMissing: [...stillMissing],
    ...diff.stats,
  };
}

function sectionIsPaused(sectionSyncEntry) {
  const at = sectionSyncEntry?.lastSyncAt;
  if (!at) return true;
  return Date.now() - Date.parse(at) > LIVE_PAUSE_MS;
}

export async function ensureAlarmsAlwaysOn() {
  await chrome.alarms.create(ALWAYS_ON_ALARM, { periodInMinutes: 1 });
}

/**
 * Main tick: ensure tab, acquire lock, run due sections.
 */
export async function alwaysOnTick({ force = false } = {}) {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const state = await getState();
    if (!state.live || !state.loggedIn) return;

    if (state.health?.pausedUntil && Date.parse(state.health.pausedUntil) > Date.now()) {
      log('always-on paused until', state.health.pausedUntil);
      return;
    }

    const tabId = await ensureRelayTab();
    const lock = await acquireSyncLock(tabId);
    if (!lock.ok) {
      log('always-on: could not acquire lock');
      return;
    }
    if (lock.foreign) {
      log('always-on: another owner holds lock on tab', lock.tabId);
      // Still allow heartbeat refresh path via ensure — skip work
      return;
    }

    startHeartbeat(lock.tabId);
    await setState({ alwaysOnTabId: lock.tabId });

    const template = await getRequestTemplate();
    if (!template?.body) {
      log('always-on: waiting for first entitiesV2 capture to seed template');
      await setState({
        syncProgress: {
          phase: 'waiting-template',
          detail: 'Pinned Relay tab open — waiting for first entitiesV2 response to seed template.',
          percent: 15,
        },
      });
      return;
    }

    const schedule = enforceScheduleMs(state.scheduleMs);
    const now = Date.now();
    const due = { ...(state.nextDueAt || {}) };

    const wasPaused =
      Boolean(state.reconnectSyncing) ||
      sectionIsPaused(state.sectionSync?.IN_TRANSIT) ||
      sectionIsPaused(state.sectionSync?.UPCOMING);

    if (wasPaused && !state.catchUp?.active) {
      await setState({
        reconnectSyncing: true,
        syncProgress: {
          phase: 'syncing',
          detail: 'Syncing with Relay…',
          percent: 20,
        },
      });
    }

    // Live sections first (always full pages)
    const liveOrder = [];
    if (force || wasPaused || !due.IN_TRANSIT || now >= due.IN_TRANSIT) liveOrder.push('IN_TRANSIT');
    if (force || wasPaused || !due.UPCOMING || now >= due.UPCOMING) liveOrder.push('UPCOMING');

    let liveSnapshotsOk = 0;
    if (wasPaused) {
      await setState({ pendingCatchUpMissing: [] });
    }

    for (const tab of liveOrder) {
      if (!(await getState()).live) break;
      const res = await syncSection(lock.tabId, tab, { page1Only: false });
      if (res.ok) {
        if (tab === 'IN_TRANSIT') due.IN_TRANSIT = now + jitter(schedule.IN_TRANSIT_MS);
        if (tab === 'UPCOMING') due.UPCOMING = now + jitter(schedule.UPCOMING_MS);
        if (res.snapshot) liveSnapshotsOk += 1;
      } else if (res.authRequired) {
        await setState({ nextDueAt: due, scheduleMs: schedule });
        return;
      }
    }

    // After live Upcoming+In Transit on reconnect/pause: HISTORY catch-up
    const stAfterLive = await getState();
    const liveMissing = [
      ...new Set(
        [
          ...(stAfterLive.pendingCatchUpMissing || []),
        ].map((id) => String(id).toUpperCase()),
      ),
    ];
    if (
      wasPaused &&
      liveSnapshotsOk > 0 &&
      !(stAfterLive.catchUp && stAfterLive.catchUp.active && stAfterLive.catchUp.startedAt)
    ) {
      const begin = await hooks.onBeginCatchUp({
        missingTripIds: liveMissing,
      });
      const missing = begin?.missingTripIds?.length ? begin.missingTripIds : liveMissing;
      const untilIso =
        begin?.untilIso ||
        new Date(
          Date.now() - CATCH_UP_LOOKBACK_MS - LIVE_PAUSE_MS,
        ).toISOString();

      if (missing.length) {
        await setState({
          catchUp: {
            active: true,
            missingTripIds: missing,
            foundTripIds: [],
            untilIso,
            startedAt: new Date().toISOString(),
          },
          syncProgress: {
            phase: 'catch-up',
            detail: `Catch-up: paging HISTORY for ${missing.length} missing trip(s)…`,
            percent: 55,
          },
        });
        const catchRes = await syncSection(lock.tabId, 'HISTORY', {
          catchUp: true,
          catchUpUntilIso: untilIso,
          missingTripIds: missing,
        });
        if (catchRes.authRequired) {
          await setState({ nextDueAt: due, scheduleMs: schedule });
          return;
        }
        await hooks.onFinalizeCatchUp({
          foundIds: catchRes.catchUpFoundIds || [],
          stillMissing: catchRes.catchUpStillMissing || [],
        });
        await setState({
          catchUp: {
            active: false,
            missingTripIds: [],
            foundTripIds: catchRes.catchUpFoundIds || [],
            untilIso: null,
            startedAt: null,
          },
          reconnectSyncing: false,
          syncProgress: {
            phase: 'always-on',
            detail: 'Catch-up complete — live mirrors restored.',
            percent: 100,
          },
        });
      } else {
        await hooks.onFinalizeCatchUp({ foundIds: [], stillMissing: [] });
        await setState({
          reconnectSyncing: false,
          catchUp: {
            active: false,
            missingTripIds: [],
            foundTripIds: [],
            untilIso: null,
            startedAt: null,
          },
          syncProgress: {
            phase: 'always-on',
            detail: 'Syncing with Relay… complete.',
            percent: 100,
          },
        });
      }
    } else if (stAfterLive.reconnectSyncing && liveSnapshotsOk >= liveOrder.length && liveOrder.length) {
      await setState({
        reconnectSyncing: false,
        syncProgress: {
          phase: 'always-on',
          detail: 'Live mirrors in sync with Relay.',
          percent: 100,
        },
      });
    }

    // Normal HISTORY: page1 next cycle (picks up trips that left In Transit)
    const historyDue = force || !due.HISTORY || now >= due.HISTORY;
    if (historyDue && (await getState()).live) {
      const histState = await getState();
      if (!histState.historyBackfillDone) {
        const res = await syncSection(lock.tabId, 'HISTORY', { page1Only: false });
        if (res.ok) {
          await setState({ historyBackfillDone: true });
          due.HISTORY = now + jitter(schedule.HISTORY_PAGE1_MS);
        }
      } else {
        const res = await syncSection(lock.tabId, 'HISTORY', { page1Only: true });
        if (res.ok) due.HISTORY = now + jitter(schedule.HISTORY_PAGE1_MS);
      }
    }

    await setState({ nextDueAt: due, scheduleMs: schedule });
  } finally {
    tickRunning = false;
  }
}

export { TABS };
