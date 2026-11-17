/**
 * Always-on entitiesV2 section sync: tab lock, request queue, schedules, change detection.
 */

import {
  DEBUG,
  ENTITIES_V2_URL,
  RELAY_TRIPS_URL,
  RELAY_IN_TRANSIT_URL,
  RELAY_TIMEZONE,
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
  FETCH_RETRY_DELAYS_MS,
  SECTION_PAUSE_RETRY_MS,
  PAGE_HEARTBEAT_STALE_MS,
  REQUEST_TEMPLATE_KEY,
  REQUEST_TEMPLATES_KEY,
  SECTION_SNAPSHOT_KEY,
  SECTION_TRIP_IDS_KEY,
  HISTORY_BACKFILL_KEY,
  SYNC_LOCK_KEY,
  LAST_ENTITIES_REQ_KEY,
  ALWAYS_ON_ALARM,
} from '../shared/config.js';
import { getState, setState } from '../shared/state.js';
import { extractTrips, tripContentHashPayload, hashString } from '../shared/extract.js';
import {
  buildTabRequestBody,
  fallbackTemplate,
  listHistoryBackfillWindows,
  historyWindowContaining,
  isFirst24hOfHistoryWeek,
  crossCheckTripSection,
  DEFAULT_TIMEZONE,
} from '../shared/templates.js';

const RELAY_HOST_RE = /^https:\/\/([a-z0-9-]+\.)?relay\.amazon\.com\//i;
const TABS = ['IN_TRANSIT', 'UPCOMING', 'HISTORY'];
const TIMEZONE = RELAY_TIMEZONE || DEFAULT_TIMEZONE;

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
    if (/^content-length$/i.test(k)) continue;
    if (v != null) out[k] = String(v);
  }
  return out;
}

/** @deprecated Prefer saveTabRequestTemplate — kept for callers during migration. */
export async function saveRequestTemplate(body, headers, meta = {}) {
  const tab = body?.tileCountTab;
  if (tab) return saveTabRequestTemplate(tab, body, headers, meta);
  return false;
}

/**
 * Store one full request body (+ headers) per tab. Never copies another tab's body.
 */
export async function saveTabRequestTemplate(tileCountTab, body, headers, meta = {}) {
  const tab = String(tileCountTab || body?.tileCountTab || '').toUpperCase();
  if (!TABS.includes(tab) || !body || typeof body !== 'object') return false;
  const stored = await chrome.storage.local.get([REQUEST_TEMPLATES_KEY]);
  const map = { ...(stored[REQUEST_TEMPLATES_KEY] || {}) };
  const template = {
    body: JSON.parse(JSON.stringify(body)),
    headers: stripCookieHeaders(headers || {}),
    url: ENTITIES_V2_URL,
    at: meta.at || new Date().toISOString(),
    pageUrl: meta.pageUrl || null,
    source: 'live',
  };
  // Ensure stored body keeps its own tileCountTab
  template.body.tileCountTab = tab;
  map[tab] = template;
  await chrome.storage.local.set({
    [REQUEST_TEMPLATES_KEY]: map,
    // Compat: keep last-written as legacy single key
    [REQUEST_TEMPLATE_KEY]: template,
    [LAST_ENTITIES_REQ_KEY]: template,
  });
  const hasAny = TABS.some((t) => map[t]?.body || fallbackTemplate(t)?.body);
  await setState({
    hasRequestTemplate: hasAny,
    templateMeta: {
      ...(await getTemplateMetaFromState()),
      [tab]: {
        source: 'live',
        at: template.at,
        label: formatTemplateSourceLabel('live', template.at),
      },
    },
  });
  return true;
}

async function getTemplateMetaFromState() {
  const state = await getState();
  return state.templateMeta || {};
}

export function formatTemplateSourceLabel(source, atIso) {
  if (source === 'fallback') return 'fallback';
  if (!atIso) return 'live capture';
  try {
    const d = new Date(atIso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `live capture ${hh}:${mm}`;
  } catch {
    return 'live capture';
  }
}

export async function getAllTabTemplates() {
  const stored = await chrome.storage.local.get([
    REQUEST_TEMPLATES_KEY,
    REQUEST_TEMPLATE_KEY,
    LAST_ENTITIES_REQ_KEY,
  ]);
  return stored[REQUEST_TEMPLATES_KEY] || {};
}

/**
 * Resolve template for one tab: live capture → built-in fallback (HISTORY/UPCOMING only).
 * IN_TRANSIT has no fallback — returns null when missing.
 */
export async function resolveTabTemplate(tileCountTab) {
  const tab = String(tileCountTab || '').toUpperCase();
  const map = await getAllTabTemplates();
  if (map[tab]?.body) {
    return {
      ...map[tab],
      source: map[tab].source || 'live',
    };
  }
  const fb = fallbackTemplate(tab);
  if (fb) return fb;
  return null;
}

/** @deprecated Any-template check; prefer resolveTabTemplate per tab. */
export async function getRequestTemplate() {
  for (const tab of TABS) {
    const t = await resolveTabTemplate(tab);
    if (t?.body) return t;
  }
  const stored = await chrome.storage.local.get([REQUEST_TEMPLATE_KEY, LAST_ENTITIES_REQ_KEY]);
  return stored[REQUEST_TEMPLATE_KEY] || stored[LAST_ENTITIES_REQ_KEY] || null;
}

/**
 * SEAM for transport / other workers: build the exact entitiesV2 POST body for a tab.
 * Deep-clones template; applies date windows + now-timestamp refresh. Never mutates storage.
 *
 * @returns {{ ok: true, body, headers, templateMeta } | { ok: false, error, needCapture?: boolean }}
 */
export async function buildRequestBody(tileCountTab, { from = 0, size = PAGE_SIZE, historyWindow = null, now = new Date() } = {}) {
  const tab = String(tileCountTab || '').toUpperCase();
  const template = await resolveTabTemplate(tab);
  if (!template?.body) {
    return {
      ok: false,
      error: 'no_template',
      needCapture: tab === 'IN_TRANSIT',
    };
  }
  const built = buildTabRequestBody(tab, template, {
    from,
    size,
    now,
    timeZone: TIMEZONE,
    historyWindow,
  });
  if (!built.ok) return { ok: false, error: built.error || 'build_failed' };
  return {
    ok: true,
    body: built.body,
    headers: stripCookieHeaders(template.headers || {}),
    url: template.url || ENTITIES_V2_URL,
    templateMeta: {
      source: template.source || 'fallback',
      at: template.at || null,
      label: formatTemplateSourceLabel(template.source || 'fallback', template.at),
    },
  };
}

async function loadHistoryBackfill() {
  const stored = await chrome.storage.local.get([HISTORY_BACKFILL_KEY]);
  return (
    stored[HISTORY_BACKFILL_KEY] || {
      done: false,
      windowIndex: 0,
      from: 0,
      tripsAccum: 0,
      totalWindows: 0,
    }
  );
}

async function saveHistoryBackfill(progress) {
  await chrome.storage.local.set({ [HISTORY_BACKFILL_KEY]: progress });
}

async function loadSectionTripIds() {
  const stored = await chrome.storage.local.get([SECTION_TRIP_IDS_KEY]);
  return (
    stored[SECTION_TRIP_IDS_KEY] || {
      IN_TRANSIT: [],
      UPCOMING: [],
      HISTORY: [],
    }
  );
}

async function saveSectionTripIds(map) {
  await chrome.storage.local.set({ [SECTION_TRIP_IDS_KEY]: map });
}

/**
 * If UPCOMING and IN_TRANSIT share trip IDs → template wrong; flag + request re-capture.
 * Returns { overlapIds, templateWrong }.
 */
export async function checkLiveSectionOverlap(tileCountTab, tripIds) {
  const map = await loadSectionTripIds();
  map[tileCountTab] = tripIds.map((id) => String(id || '').toUpperCase()).filter(Boolean);
  await saveSectionTripIds(map);

  const a = new Set(map.UPCOMING || []);
  const b = new Set(map.IN_TRANSIT || []);
  const overlapIds = [...a].filter((id) => b.has(id));
  const templateWrong = overlapIds.length > 0;

  if (templateWrong) {
    const wrongFor = [];
    if (tileCountTab === 'UPCOMING' || tileCountTab === 'IN_TRANSIT') wrongFor.push(tileCountTab);
    // Flag both live tabs when overlap exists
    await setState({
      templateWrong: {
        UPCOMING: true,
        IN_TRANSIT: true,
        message: `template wrong for ${wrongFor.join(' / ') || 'live tabs'} — re-capture; CRM not overwritten`,
        overlapIds: overlapIds.slice(0, 20),
        at: new Date().toISOString(),
      },
    });
    // Drop live templates so next tick re-captures
    const templates = await getAllTabTemplates();
    delete templates.UPCOMING;
    delete templates.IN_TRANSIT;
    await chrome.storage.local.set({ [REQUEST_TEMPLATES_KEY]: templates });
  } else if (tileCountTab === 'UPCOMING' || tileCountTab === 'IN_TRANSIT') {
    const state = await getState();
    if (state.templateWrong?.UPCOMING || state.templateWrong?.IN_TRANSIT) {
      await setState({
        templateWrong: {
          UPCOMING: false,
          IN_TRANSIT: false,
          message: null,
          overlapIds: [],
          at: null,
        },
      });
    }
  }

  return { overlapIds, templateWrong };
}

/** Navigate pinned sync tab to In Transit once so Relay emits a captureable entitiesV2. */
export async function ensureInTransitCapture(tabId) {
  const state = await getState();
  if (state.inTransitCaptureNavAt) {
    const age = Date.now() - Date.parse(state.inTransitCaptureNavAt);
    if (Number.isFinite(age) && age < 5 * 60 * 1000) {
      return { ok: false, skipped: 'recent_nav' };
    }
  }
  try {
    await chrome.tabs.update(tabId, { url: RELAY_IN_TRANSIT_URL, active: false });
    await setState({
      inTransitCaptureNavAt: new Date().toISOString(),
      syncProgress: {
        phase: 'waiting-template',
        detail: 'Navigating Relay In Transit once to capture IN_TRANSIT filter body…',
        percent: 18,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
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
      await chrome.tabs.update(preferred.id, {
        pinned: true,
        active: false,
        autoDiscardable: false,
      });
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
  if (created?.id != null) {
    try {
      await chrome.tabs.update(created.id, { autoDiscardable: false });
    } catch {
      /* ignore */
    }
  }
  await setState({ alwaysOnTabId: created.id });
  return created.id;
}

function makeFetchError({ url, context, status, message, tab }) {
  return {
    url: url || ENTITIES_V2_URL,
    context: context || 'background',
    status: status ?? null,
    message: String(message || 'fetch failed'),
    tab: tab || null,
    at: new Date().toISOString(),
  };
}

async function recordFetchError(tileCountTab, errObj) {
  await setState({
    lastFetchError: errObj,
    sectionSync: {
      [tileCountTab]: {
        lastError: errObj.message,
        lastFetchError: errObj,
      },
    },
  });
}

async function waitRequestGap(extraMs = 0) {
  const gap = Math.max(MIN_REQUEST_GAP_MS, extraMs);
  const wait = Math.max(0, gap - (Date.now() - lastRequestAt));
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Single entitiesV2 POST via page MAIN world (never from SW fetch).
 * Body comes from buildRequestBody (per-tab template + windows) — transport only here.
 * Retries 3× with 2s / 5s / 15s backoff before caller marks section paused.
 */
export async function fetchEntitiesPage(
  tabId,
  tileCountTab,
  from,
  size = PAGE_SIZE,
  { historyWindow = null } = {},
) {
  const built = await buildRequestBody(tileCountTab, { from, size, historyWindow });
  if (!built.ok) {
    return {
      ok: false,
      error: built.error || 'no_template',
      needCapture: Boolean(built.needCapture),
      authRequired: false,
    };
  }

  const body = built.body;
  const url = built.url || ENTITIES_V2_URL;
  const headers = built.headers || {};
  const delays = FETCH_RETRY_DELAYS_MS;
  let lastFail = null;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    await waitRequestGap();
    if (requestInFlight) {
      return { ok: false, error: 'in_flight' };
    }
    requestInFlight = true;
    lastRequestAt = Date.now();
    try {
      let result;
      try {
        result = await chrome.tabs.sendMessage(tabId, {
          type: 'RELAY_FETCH_ENTITIES_V2',
          url,
          body,
          headers,
        });
      } catch (err) {
        lastFail = makeFetchError({
          url,
          context: 'content',
          status: null,
          message: err?.message || err,
          tab: tileCountTab,
        });
        await recordFetchError(tileCountTab, lastFail);
        if (attempt < delays.length) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
        return { ok: false, error: lastFail.message, lastFetchError: lastFail };
      }

      if (result?.authRequired || result?.status === 401 || result?.status === 403) {
        await hooks.onAuthRequired(result);
        const errObj = makeFetchError({
          url,
          context: result?.context || 'page',
          status: result?.status,
          message: result?.error || 'Log in to Relay',
          tab: tileCountTab,
        });
        await recordFetchError(tileCountTab, errObj);
        return {
          ok: false,
          authRequired: true,
          status: result.status,
          error: result.error,
          lastFetchError: errObj,
        };
      }

      if (!result?.ok) {
        const status = result?.status || 0;
        lastFail = makeFetchError({
          url,
          context: result?.context || 'page',
          status,
          message: result?.error || 'fetch_failed',
          tab: tileCountTab,
        });
        await recordFetchError(tileCountTab, lastFail);
        if (status === 429 || status >= 500) {
          await hooks.onBackoff(status, httpBackoffMs);
          httpBackoffMs = Math.min(HTTP_BACKOFF_MAX_MS, httpBackoffMs * 2);
        }
        if (attempt < delays.length) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
        return {
          ok: false,
          status,
          error: lastFail.message,
          lastFetchError: lastFail,
        };
      }

      httpBackoffMs = HTTP_BACKOFF_BASE_MS;
      await hooks.onHealthy();

      if (built.templateMeta) {
        await setState({
          templateMeta: {
            ...(await getTemplateMetaFromState()),
            [tileCountTab]: built.templateMeta,
          },
        });
      }

      return {
        ok: true,
        data: result.data,
        requestBody: body,
        totalRecords: Number(result.data?.totalRecords) || 0,
        entities: Array.isArray(result.data?.entities) ? result.data.entities : [],
        templateMeta: built.templateMeta,
      };
    } finally {
      requestInFlight = false;
      lastRequestAt = Date.now();
    }
  }

  return {
    ok: false,
    error: lastFail?.message || 'fetch_failed',
    lastFetchError: lastFail,
  };
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
 * Fetch all pages for a tab (or HISTORY window / catch-up).
 * catchUp: page HISTORY newest-first until older than untilIso or all missing found.
 * historyWindow: optional { startISO, endISO } for HISTORY date window.
 */
export async function syncSection(
  tabId,
  tileCountTab,
  {
    page1Only = false,
    catchUp = false,
    catchUpUntilIso = null,
    missingTripIds = [],
    historyWindow = null,
    startFrom = 0,
    onPageProgress = null,
    /** Cap pages this call (History backfill steps use 1). */
    maxPages = null,
    /** Return early between pages when live IN_TRANSIT/UPCOMING is due. */
    shouldYield = null,
    /** Ignore version/hash — push every trip in this fetch. */
    forceResync = false,
  } = {},
) {
  const state = await getState();
  if (state.health?.pausedUntil && Date.parse(state.health.pausedUntil) > Date.now()) {
    return { ok: false, skipped: 'paused' };
  }

  // Require a real per-tab body (IN_TRANSIT has no fallback)
  const resolved = await resolveTabTemplate(tileCountTab);
  if (!resolved?.body) {
    if (tileCountTab === 'IN_TRANSIT') {
      await ensureInTransitCapture(tabId);
    }
    await setState({
      sectionSync: {
        [tileCountTab]: {
          lastError:
            tileCountTab === 'IN_TRANSIT'
              ? 'no IN_TRANSIT template — navigate Relay In Transit to capture'
              : 'no_template',
          lastSyncAt: new Date().toISOString(),
        },
      },
    });
    return { ok: false, error: 'no_template', needCapture: tileCountTab === 'IN_TRANSIT' };
  }

  const allTrips = [];
  let pages = 0;
  let from = Math.max(0, Number(startFrom) || 0);
  let totalRecords = Infinity;
  const stillMissing = new Set(
    (missingTripIds || []).map((id) => String(id || '').toUpperCase()).filter(Boolean),
  );
  const foundIds = [];
  const untilMs = catchUpUntilIso ? Date.parse(catchUpUntilIso) : null;
  const mismatches = [];

  for (;;) {
    if (!(await getState()).live) return { ok: false, skipped: 'stopped' };

    const gap = tileCountTab === 'HISTORY' ? HISTORY_PAGE_GAP_MS : MIN_REQUEST_GAP_MS;
    const page = await fetchEntitiesPage(tabId, tileCountTab, from, PAGE_SIZE, { historyWindow });
    if (!page.ok) {
      if (page.needCapture && tileCountTab === 'IN_TRANSIT') {
        await ensureInTransitCapture(tabId);
      }
      const pausedUntil = new Date(Date.now() + SECTION_PAUSE_RETRY_MS).toISOString();
      await setState({
        sectionSync: {
          [tileCountTab]: {
            lastError: page.error || 'fetch failed',
            lastFetchError: page.lastFetchError || null,
            lastSyncAt: new Date().toISOString(),
            paused: true,
            pausedUntil,
          },
        },
      });
      return page;
    }

    pages += 1;
    totalRecords = page.totalRecords || totalRecords;
    const trips = extractTrips(ENTITIES_V2_URL, page.data, page.requestBody);
    for (const t of trips) {
      // Section assignment = tab whose request returned it
      t.tab = tileCountTab;
      t.section = String(tileCountTab || '').toLowerCase();
      const check = crossCheckTripSection(tileCountTab, t);
      if (!check.ok) {
        mismatches.push({ tripId: t.tripId, reason: check.reason });
        log(`section mismatch ${tileCountTab} trip=${t.tripId}: ${check.reason}`);
      }
    }
    allTrips.push(...trips);

    if (typeof onPageProgress === 'function') {
      await onPageProgress({ from, pages, trips: allTrips.length, totalRecords, page });
    }

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
      if (maxPages != null && pages >= maxPages) {
        from += PAGE_SIZE;
        break;
      }
      if (typeof shouldYield === 'function' && (await shouldYield())) {
        from += PAGE_SIZE;
        break;
      }
      from += PAGE_SIZE;
      await waitRequestGap(gap);
      continue;
    }

    const got = page.entities.length;
    if (page1Only) break;
    if (got < PAGE_SIZE) break;
    from += PAGE_SIZE;
    if (from >= totalRecords) break;
    if (maxPages != null && pages >= maxPages) break;
    if (typeof shouldYield === 'function' && (await shouldYield())) break;
    // HISTORY: enforce 2s between pages
    await waitRequestGap(gap);
  }

  const uniqueIds = [
    ...new Set(allTrips.map((t) => String(t.tripId || '').toUpperCase()).filter(Boolean)),
  ];
  const reportedTotal =
    Number.isFinite(totalRecords) && totalRecords !== Infinity ? Number(totalRecords) : uniqueIds.length;

  // Live overlap → template wrong; do not overwrite CRM
  let skipCrm = false;
  if (tileCountTab === 'UPCOMING' || tileCountTab === 'IN_TRANSIT') {
    const overlap = await checkLiveSectionOverlap(tileCountTab, uniqueIds);
    if (overlap.templateWrong) {
      skipCrm = true;
      await setState({
        sectionSync: {
          [tileCountTab]: {
            lastSyncAt: new Date().toISOString(),
            lastError: `template wrong for ${tileCountTab} — overlap ${overlap.overlapIds.length} trip(s); re-capture`,
            trips: uniqueIds.length,
            pages,
          },
        },
      });
      return {
        ok: false,
        error: 'template_wrong',
        templateWrong: true,
        overlapIds: overlap.overlapIds,
        trips: uniqueIds.length,
        pages,
        totalRecords: reportedTotal,
      };
    }
  }

  const diff = await diffSectionTrips(tileCountTab, allTrips);
  log(
    `tab=${tileCountTab} pages=${pages} trips=${diff.stats.trips} new=${diff.stats.newCount} changed=${diff.stats.changedCount} removed=${diff.stats.removedCount}${
      catchUp ? ` catchUpFound=${foundIds.length} stillMissing=${stillMissing.size}` : ''
    }${mismatches.length ? ` mismatches=${mismatches.length}` : ''}`,
  );

  await setState({
    sectionSync: {
      [tileCountTab]: {
        lastSyncAt: new Date().toISOString(),
        lastError: mismatches.length
          ? `section mismatch ×${mismatches.length}: ${mismatches[0].reason}`
          : null,
        lastFetchError: null,
        paused: false,
        pausedUntil: null,
        trips: diff.stats.trips,
        pages,
        newCount: diff.stats.newCount,
        changedCount: diff.stats.changedCount,
        removedCount: diff.stats.removedCount,
        totalRecords: reportedTotal,
      },
    },
    lastFetchError: null,
    lastTripsScanAt: new Date().toISOString(),
  });

  if (tileCountTab === 'IN_TRANSIT') {
    await setState({
      health: { inTransitCount: diff.stats.trips },
    });
  }

  // Snapshot only after full pagination, counts match — use totalRecords / entitiesInResponse
  let snapshot = null;
  if (!page1Only && !catchUp && !skipCrm) {
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

  if (!skipCrm) {
    const stForce = (await getState()).forceResync;
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
      sectionMismatches: mismatches,
      forceResync: Boolean(forceResync || stForce),
    });
  }

  return {
    ok: true,
    pages,
    totalRecords: reportedTotal,
    snapshot,
    catchUpFoundIds: foundIds,
    catchUpStillMissing: [...stillMissing],
    sectionMismatches: mismatches,
    skipCrm,
    ...diff.stats,
  };
}

/**
 * One HISTORY step only (P3): a single backfill page, or one ongoing window pass.
 * Live IN_TRANSIT/UPCOMING must interleave between steps — never run full multi-week loop here.
 */
export async function syncHistoryOneStep(tabId, { shouldYield = null, forceResync = false } = {}) {
  const now = new Date();
  const windows = listHistoryBackfillWindows(now, TIMEZONE);
  const progress = await loadHistoryBackfill();
  const st = await getState();
  const force = Boolean(forceResync || st.forceResync);
  const crmAccum = Number(st.historyBackfillProgress?.crmTrips) || Number(progress.crmAccum) || 0;

  if (!progress.done) {
    const totalWindows = windows.length || 1;
    const idx = Math.min(progress.windowIndex || 0, totalWindows - 1);
    const win = windows[idx];
    if (!win) {
      await saveHistoryBackfill({
        done: true,
        windowIndex: totalWindows,
        from: 0,
        tripsAccum: progress.tripsAccum || 0,
        crmAccum,
        totalWindows,
        completedAt: new Date().toISOString(),
      });
      return { ok: true, backfill: true, done: true };
    }

    const startFrom = progress.from || 0;
    let tripsAccum = progress.tripsAccum || 0;
    const weekLabel = `backfill week ${idx + 1}/${totalWindows}`;

    await setState({
      syncProgress: {
        phase: 'history-backfill',
        detail: `Week ${idx + 1}/${totalWindows} · ${tripsAccum} trips`,
        percent: Math.min(95, 20 + Math.round(((idx + 0.5) / totalWindows) * 70)),
        historyWeeks: windows.slice(0, idx + 1).map((w) => w.label),
      },
      historyBackfillProgress: {
        week: idx + 1,
        totalWeeks: totalWindows,
        trips: tripsAccum,
        crmTrips: crmAccum,
        label: weekLabel,
      },
    });

    const res = await syncSection(tabId, 'HISTORY', {
      historyWindow: win,
      startFrom,
      maxPages: 1,
      shouldYield,
      forceResync: force,
    });

    if (!res.ok) {
      await saveHistoryBackfill({
        done: false,
        windowIndex: idx,
        from: startFrom,
        tripsAccum,
        crmAccum,
        totalWindows,
      });
      return { ...res, backfillPaused: { week: idx + 1, page: Math.floor(startFrom / PAGE_SIZE) + 1 } };
    }

    const pageTrips = res.trips || 0;
    tripsAccum += pageTrips;
    const nextFrom = startFrom + PAGE_SIZE;
    const windowDone =
      pageTrips < PAGE_SIZE ||
      nextFrom >= (res.totalRecords || nextFrom) ||
      (res.pages || 0) === 0;

    const nextCrm = crmAccum + pageTrips;
    if (windowDone) {
      const nextIdx = idx + 1;
      if (nextIdx >= totalWindows) {
        await saveHistoryBackfill({
          done: true,
          windowIndex: totalWindows,
          from: 0,
          tripsAccum,
          crmAccum: nextCrm,
          totalWindows,
          completedAt: new Date().toISOString(),
        });
        await setState({
          historyBackfillDone: true,
          forceResync: false,
          historyBackfillProgress: {
            week: totalWindows,
            totalWeeks: totalWindows,
            trips: tripsAccum,
            crmTrips: nextCrm,
            label: `Backfill done · ${tripsAccum} trips`,
          },
          sectionCounts: {
            HISTORY: { relay: tripsAccum, crm: nextCrm, mismatch: false },
          },
        });
        return { ok: true, backfill: true, done: true, trips: tripsAccum };
      }
      await saveHistoryBackfill({
        done: false,
        windowIndex: nextIdx,
        from: 0,
        tripsAccum,
        crmAccum: nextCrm,
        totalWindows,
      });
    } else {
      await saveHistoryBackfill({
        done: false,
        windowIndex: idx,
        from: nextFrom,
        tripsAccum,
        crmAccum: nextCrm,
        totalWindows,
      });
    }

    await setState({
      historyBackfillProgress: {
        week: idx + 1,
        totalWeeks: totalWindows,
        trips: tripsAccum,
        crmTrips: nextCrm,
        label: weekLabel,
      },
      sectionCounts: {
        HISTORY: { relay: tripsAccum, crm: nextCrm, mismatch: false },
      },
    });

    return {
      ok: true,
      backfill: true,
      done: false,
      trips: tripsAccum,
      backfillPaused: {
        week: idx + 1,
        page: Math.floor((windowDone ? 0 : nextFrom) / PAGE_SIZE) + (windowDone ? 1 : 0),
      },
    };
  }

  // Ongoing: current window only (yield-aware multi-page via shouldYield)
  const current = historyWindowContaining(now, TIMEZONE);
  const res = await syncSection(tabId, 'HISTORY', {
    historyWindow: current,
    shouldYield,
    maxPages: shouldYield ? 2 : null,
    forceResync: force,
  });
  if (!res.ok) return res;

  if (isFirst24hOfHistoryWeek(now, TIMEZONE) && windows.length > 1 && !(shouldYield && (await shouldYield()))) {
    const prev = windows[1];
    const prevRes = await syncSection(tabId, 'HISTORY', {
      historyWindow: prev,
      shouldYield,
      maxPages: 1,
      forceResync: force,
    });
    if (!prevRes.ok) return prevRes;
    return { ok: true, ongoing: true, pages: (res.pages || 0) + (prevRes.pages || 0) };
  }
  return { ok: true, ongoing: true, ...res };
}

/** @deprecated — use syncHistoryOneStep so live sync can interleave */
export async function syncHistoryWindows(tabId) {
  return syncHistoryOneStep(tabId);
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
export async function alwaysOnTick({ force = false, forceResync = false } = {}) {
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

    // Keep sync tab alive; reload if page heartbeat missing for 2 minutes.
    try {
      await chrome.tabs.update(tabId, { autoDiscardable: false });
    } catch {
      /* ignore */
    }
    const hbAt = state.pageHeartbeatAt ? Date.parse(state.pageHeartbeatAt) : 0;
    if (hbAt && Date.now() - hbAt > PAGE_HEARTBEAT_STALE_MS) {
      log('page heartbeat stale — reloading sync tab', tabId);
      try {
        await chrome.tabs.reload(tabId);
        await setState({ pageHeartbeatAt: new Date().toISOString() });
        await new Promise((r) => setTimeout(r, 4000));
      } catch (err) {
        log('tab reload failed', err?.message || err);
      }
    }

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

    // Per-tab templates: HISTORY/UPCOMING have fallbacks; IN_TRANSIT needs live capture
    const upcomingTpl = await resolveTabTemplate('UPCOMING');
    const historyTpl = await resolveTabTemplate('HISTORY');
    const inTransitTpl = await resolveTabTemplate('IN_TRANSIT');
    if (!upcomingTpl?.body && !historyTpl?.body && !inTransitTpl?.body) {
      log('always-on: waiting for first entitiesV2 capture to seed templates');
      await setState({
        syncProgress: {
          phase: 'waiting-template',
          detail: 'Pinned Relay tab open — waiting for entitiesV2 to seed per-tab templates.',
          percent: 15,
        },
      });
      return;
    }
    if (!inTransitTpl?.body) {
      await ensureInTransitCapture(lock.tabId);
    }

    const schedule = enforceScheduleMs(state.scheduleMs);
    let now = Date.now();
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

    // Force live once on reconnect/GO LIVE by zeroing due; do not keep wasPaused sticky in isLiveDue
    if (force || wasPaused) {
      due.IN_TRANSIT = 0;
      due.UPCOMING = 0;
    }

    const isLiveDue = (tab, t = Date.now()) => {
      if (!due[tab] || t >= due[tab]) return true;
      return false;
    };

    const backfillPauseLabel = async () => {
      const p = await loadHistoryBackfill();
      if (p.done) return 'backfill done';
      const week = (p.windowIndex || 0) + 1;
      const page = Math.floor((p.from || 0) / PAGE_SIZE) + 1;
      return `backfill paused at week ${week} page ${page}`;
    };

    /** Priority queue: P1 IN_TRANSIT → P2 UPCOMING → P3 HISTORY (only if no live due). */
    const pickNext = async () => {
      const t = Date.now();
      if (isLiveDue('IN_TRANSIT', t)) return 'IN_TRANSIT';
      if (isLiveDue('UPCOMING', t)) return 'UPCOMING';
      const histDue = force || !due.HISTORY || t >= due.HISTORY;
      const bf = await loadHistoryBackfill();
      if (histDue || !bf.done) return 'HISTORY';
      return null;
    };

    let liveSnapshotsOk = 0;
    if (wasPaused) {
      await setState({ pendingCatchUpMissing: [] });
    }

    // Drain priority queue for this tick (live first; at most one HISTORY page when idle)
    let historySteps = 0;
    const maxHistoryStepsPerTick = 1;
    for (;;) {
      if (!(await getState()).live) break;
      const next = await pickNext();
      if (!next) break;

      const pauseLbl = await backfillPauseLabel();
      if (next === 'IN_TRANSIT' || next === 'UPCOMING') {
        log(`[Queue] next=${next} (due) | ${pauseLbl}`);
      } else {
        log(`[Queue] next=HISTORY | ${pauseLbl}`);
      }

      if (next === 'IN_TRANSIT' || next === 'UPCOMING') {
        const sec = (await getState()).sectionSync?.[next];
        if (
          !force &&
          sec?.paused &&
          sec.pausedUntil &&
          Date.parse(sec.pausedUntil) > Date.now()
        ) {
          log(`section ${next} paused until`, sec.pausedUntil);
          due[next] = Date.parse(sec.pausedUntil);
          continue;
        }
        const tickForceResync = Boolean(forceResync || (await getState()).forceResync);
        const res = await syncSection(lock.tabId, next, {
          page1Only: false,
          forceResync: tickForceResync,
        });
        now = Date.now();
        if (res.ok) {
          if (next === 'IN_TRANSIT') due.IN_TRANSIT = now + jitter(schedule.IN_TRANSIT_MS);
          if (next === 'UPCOMING') due.UPCOMING = now + jitter(schedule.UPCOMING_MS);
          if (res.snapshot) liveSnapshotsOk += 1;
        } else if (res.authRequired) {
          await setState({ nextDueAt: due, scheduleMs: schedule });
          return;
        } else if (res.templateWrong) {
          log(`always-on: template wrong for ${next}, skipping CRM overwrite`);
          due[next] = now + jitter(schedule[`${next}_MS`] || schedule.IN_TRANSIT_MS);
        } else {
          due[next] = now + SECTION_PAUSE_RETRY_MS;
        }
        continue;
      }

      // P3 HISTORY — only reached when no live refresh is due
      if (historySteps >= maxHistoryStepsPerTick) break;
      historySteps += 1;
      const shouldYield = async () => isLiveDue('IN_TRANSIT') || isLiveDue('UPCOMING');
      const histForce = Boolean(forceResync || (await getState()).forceResync);
      const res = await syncHistoryOneStep(lock.tabId, {
        shouldYield,
        forceResync: histForce,
      });
      now = Date.now();
      if (res.authRequired) {
        await setState({ nextDueAt: due, scheduleMs: schedule });
        return;
      }
      if (res.ok && res.done) {
        due.HISTORY = now + jitter(schedule.HISTORY_PAGE1_MS);
        if ((await getState()).forceResync) await setState({ forceResync: false });
      } else if (res.ok && res.ongoing) {
        due.HISTORY = now + jitter(schedule.HISTORY_PAGE1_MS);
      } else if (res.ok && res.backfill) {
        // More backfill pages remain — keep HISTORY "due" so next idle tick continues
        due.HISTORY = 0;
      }
      // Re-loop: if live became due during HISTORY page, pickNext returns live next
      if (await shouldYield()) continue;
      break;
    }

    // After live Upcoming+In Transit on reconnect/pause: HISTORY catch-up (yield-aware pages)
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
        new Date(Date.now() - CATCH_UP_LOOKBACK_MS - LIVE_PAUSE_MS).toISOString();

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
        log(`[Queue] next=HISTORY (catch-up) | ${await backfillPauseLabel()}`);
        const catchRes = await syncSection(lock.tabId, 'HISTORY', {
          catchUp: true,
          catchUpUntilIso: untilIso,
          missingTripIds: missing,
          shouldYield: async () => isLiveDue('IN_TRANSIT') || isLiveDue('UPCOMING'),
          maxPages: 3,
        });
        if (catchRes.authRequired) {
          await setState({ nextDueAt: due, scheduleMs: schedule });
          return;
        }
        // Finalize when catch-up finished or yielded with no still-missing urgency this tick
        const still = catchRes.catchUpStillMissing || [];
        if (!still.length || catchRes.ok) {
          await hooks.onFinalizeCatchUp({
            foundIds: catchRes.catchUpFoundIds || [],
            stillMissing: still,
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
              detail: still.length
                ? `Catch-up partial — ${still.length} still missing; live mirrors resume.`
                : 'Catch-up complete — live mirrors restored.',
              percent: 100,
            },
          });
        }
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
    } else if (stAfterLive.reconnectSyncing && liveSnapshotsOk >= 1) {
      await setState({
        reconnectSyncing: false,
        syncProgress: {
          phase: 'always-on',
          detail: 'Live mirrors in sync with Relay.',
          percent: 100,
        },
      });
    }

    await setState({ nextDueAt: due, scheduleMs: schedule });
  } finally {
    tickRunning = false;
  }
}

export { TABS };
