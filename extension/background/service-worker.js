import {
  RELAY_SYNC_FN,
  RELAY_SNAPSHOT_FN,
  RELAY_TELEGRAM_FN,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  SECTIONS,
  SYNC_ALARM,
  ALWAYS_ON_ALARM,
  DEBUG,
  MAX_RAW_CAPTURES,
  SYNC_FLUSH_MINUTES,
  FLUSH_TIMEOUT_MS,
  FLUSH_BATCH_SIZE,
  FLUSH_BACKOFF_BASE_MS,
  FLUSH_BACKOFF_MAX_MS,
  TYPICAL_FULL_SYNC_SECONDS,
  RAW_CAPTURES_KEY,
  TRIP_HASH_KEY,
  ENTITIES_V2_URL,
  HTTP_BACKOFF_MAX_MS,
  SCHEDULE_MIN,
  isTripsBoardUrl,
  HISTORY_SKIP_TTL_MS,
} from '../shared/config.js';
import { getState, setState, updateSection, ensureClientId } from '../shared/state.js';
import {
  hashLoadPayload,
  isCompleteLoad,
  isCompletePayment,
  finalizeLoadForSync,
  isValidRelayLoadId,
  sanitizeDriverName,
  isGoodLocation,
  mapLoadStatus,
} from '../shared/normalize.js';
import { extractTrips, countTripStats, tripContentHashPayload, hashString } from '../shared/extract.js';
import { tripsToCrmLoads, tripsToEdgePayload } from '../shared/map-to-crm.js';
import {
  configureAlwaysOn,
  saveRequestTemplate,
  getRequestTemplate,
  stripCookieHeaders,
  enforceScheduleMs,
  ensureAlarmsAlwaysOn,
  alwaysOnTick,
  stopHeartbeat,
} from './always-on-sync.js';

const RELAY_HOST_RE = /^https:\/\/([a-z0-9-]+\.)?relay\.amazon\.com\//i;

let flushRunning = false;
let flushBackoffMs = FLUSH_BACKOFF_BASE_MS;

function log(...args) {
  if (DEBUG) console.log('[RelayCapture]', ...args);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      Math.max(1000, ms),
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Strip phone/email from raw entity before storage. */
function sanitizeEntityForStorage(entity) {
  try {
    const clone = JSON.parse(JSON.stringify(entity));
    const scrubPerson = (p) => {
      if (!p || typeof p !== 'object') return p;
      return { firstName: p.firstName ?? null, lastName: p.lastName ?? null };
    };
    if (Array.isArray(clone.drivers)) clone.drivers = clone.drivers.map(scrubPerson);
    if (Array.isArray(clone.loads)) {
      for (const load of clone.loads) {
        if (Array.isArray(load.driverList)) load.driverList = load.driverList.map(scrubPerson);
      }
    }
    return clone;
  } catch {
    return entity;
  }
}

function sanitizeCaptureJson(data) {
  try {
    if (!data || typeof data !== 'object') return data;
    if (!Array.isArray(data.entities)) return data;
    return { ...data, entities: data.entities.map(sanitizeEntityForStorage) };
  } catch {
    return data;
  }
}

async function updateBadge() {
  try {
    const state = await getState();
    if (!state.live) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    if (state.health?.status === 'auth') {
      await chrome.action.setBadgeBackgroundColor({ color: '#c62828' });
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setTitle({ title: 'Log in to Relay' });
      return;
    }
    if (state.health?.status === 'backoff') {
      await chrome.action.setBadgeBackgroundColor({ color: '#ef6c00' });
      await chrome.action.setBadgeText({ text: '…' });
      return;
    }
    const n = Number(state.health?.inTransitCount) || 0;
    await chrome.action.setBadgeBackgroundColor({ color: '#2e7d32' });
    await chrome.action.setBadgeText({ text: n > 0 ? String(Math.min(n, 999)) : '0' });
    await chrome.action.setTitle({
      title: `Relay Sync — ${n} in transit`,
    });
  } catch {
    /* ignore */
  }
}

configureAlwaysOn({
  log,
  onAuthRequired: async () => {
    await setState({
      health: {
        status: 'auth',
        message: 'Log in to Relay',
        lastAuthErrorAt: new Date().toISOString(),
      },
      reconnectSyncing: true,
      syncProgress: {
        phase: 'auth',
        detail: 'Paused — log in to Amazon Relay, then sync resumes automatically.',
        percent: 0,
      },
    });
    await updateBadge();
  },
  onHealthy: async () => {
    const state = await getState();
    if (state.health?.status !== 'healthy') {
      await setState({
        health: { status: 'healthy', message: '', pausedUntil: null },
      });
    }
    await updateBadge();
  },
  onBackoff: async (status, delayMs) => {
    const until = new Date(Date.now() + Math.min(HTTP_BACKOFF_MAX_MS, delayMs)).toISOString();
    await setState({
      health: {
        status: 'backoff',
        message: `HTTP ${status} — backing off`,
        pausedUntil: until,
      },
    });
    await updateBadge();
  },
  onTripsDiff: async (diff) => {
    await handleTripsDiff(diff);
  },
  onBeginCatchUp: async ({ missingTripIds }) => {
    return beginCatchUpOnEdge(missingTripIds || []);
  },
  onFinalizeCatchUp: async () => {
    await finalizeCatchUpOnEdge();
  },
});

async function ensureAlarms() {
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_FLUSH_MINUTES });
  await ensureAlarmsAlwaysOn();
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureClientId();
  flushRunning = false;
  await setState({ scanInProgress: false });
  await ensureAlarms();
  await updateBadge();
});

chrome.runtime.onStartup?.addListener?.(async () => {
  flushRunning = false;
  await ensureAlarms();
  const state = await getState();
  if (state.live && state.loggedIn) {
    void alwaysOnTick({ force: true });
  }
  await updateBadge();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const state = await getState();
  if (!state.live || !state.loggedIn) return;
  if (alarm.name === SYNC_ALARM) {
    void flushToEdge();
  }
  if (alarm.name === ALWAYS_ON_ALARM || alarm.name === SYNC_ALARM) {
    void alwaysOnTick({ force: false });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'RELAY_PAGE_HEARTBEAT') {
        await setState({ pageHeartbeatAt: new Date().toISOString() });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === 'GET_STATE') {
        sendResponse({ ok: true, state: await getState() });
        return;
      }
      if (msg?.type === 'LOGIN') {
        const { username, password, extensionApiKey } = msg;
        if (username === 'admin' && password === 'qwerty') {
          const next = await setState({
            loggedIn: true,
            extensionApiKey: extensionApiKey || (await getState()).extensionApiKey || '',
          });
          sendResponse({ ok: true, state: next });
        } else {
          sendResponse({ ok: false, error: 'Invalid username or password' });
        }
        return;
      }
      if (msg?.type === 'LOGOUT') {
        stopHeartbeat();
        await setState({ loggedIn: false, live: false });
        await updateBadge();
        sendResponse({ ok: true, state: await getState() });
        return;
      }
      if (msg?.type === 'SET_API_KEY') {
        sendResponse({
          ok: true,
          state: await setState({ extensionApiKey: msg.extensionApiKey || '' }),
        });
        return;
      }
      if (msg?.type === 'SET_SCHEDULE') {
        const scheduleMs = enforceScheduleMs(msg.scheduleMs || {});
        sendResponse({ ok: true, state: await setState({ scheduleMs }) });
        return;
      }
      if (msg?.type === 'GO_LIVE') {
        const state = await getState();
        if (!state.loggedIn) {
          sendResponse({ ok: false, error: 'Login required' });
          return;
        }
        if (!SUPABASE_ANON_KEY) {
          sendResponse({
            ok: false,
            error: `Set SUPABASE_ANON_KEY in extension/shared/config.js for ${SUPABASE_URL}`,
          });
          return;
        }
        if (!state.extensionApiKey) {
          sendResponse({
            ok: false,
            error: 'Set Extension API key (RELAY_EXTENSION_API_KEY) first',
          });
          return;
        }
        flushRunning = false;
        const hasTpl = Boolean(await getRequestTemplate());
        await setState({
          live: true,
          syncErrors: [],
          prompts: [],
          hasRequestTemplate: hasTpl,
          health: { status: 'healthy', message: '', pausedUntil: null },
          nextDueAt: { IN_TRANSIT: 0, UPCOMING: 0, HISTORY: 0 },
          syncProgress: {
            phase: 'always-on',
            detail: hasTpl
              ? 'Always-on sync starting — IN_TRANSIT / UPCOMING / HISTORY.'
              : 'Opening Relay tab to seed entitiesV2 request template…',
            percent: 10,
            startedAt: new Date().toISOString(),
            typicalSeconds: TYPICAL_FULL_SYNC_SECONDS,
            historyWeeks: [],
          },
        });
        await ensureAlarms();
        await refreshOpenTabs();
        sendResponse({ ok: true, state: await getState() });
        await updateBadge();
        void alwaysOnTick({ force: true });
        void flushToEdge();
        return;
      }
      if (msg?.type === 'STOP') {
        flushRunning = false;
        stopHeartbeat();
        await setState({
          live: false,
          health: { status: 'idle', message: '' },
          syncProgress: {
            phase: 'idle',
            detail: 'Stopped',
            percent: 0,
            typicalSeconds: TYPICAL_FULL_SYNC_SECONDS,
          },
        });
        await updateBadge();
        sendResponse({ ok: true, state: await getState() });
        return;
      }
      if (msg?.type === 'FORCE_SCAN') {
        await refreshOpenTabs();
        void alwaysOnTick({ force: true });
        void flushToEdge();
        sendResponse({ ok: true, state: await getState() });
        return;
      }
      if (msg?.type === 'RELAY_CAPTURE') {
        sendResponse({ ok: true });
        void handleCapture(msg);
        return;
      }
      if (msg?.type === 'GET_RAW_CAPTURES') {
        const stored = await chrome.storage.local.get([RAW_CAPTURES_KEY]);
        sendResponse({ ok: true, captures: stored[RAW_CAPTURES_KEY] || [] });
        return;
      }
      sendResponse({ ok: false, error: 'Unknown message' });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
});

async function refreshOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    const relayTabs = tabs.filter((t) => t.url && RELAY_HOST_RE.test(t.url) && t.id != null);
    await setState({
      openTabs: relayTabs.map((t) => ({ id: t.id, url: t.url, title: t.title })),
    });
    const hasTrips = relayTabs.some((t) => isTripsBoardUrl(t.url) || /relay\.amazon\.com/i.test(t.url));
    const prompts = [];
    if (!hasTrips) {
      prompts.push({
        sectionId: 'tours',
        message:
          'Always-on will open a pinned Relay tab automatically when LIVE. Stay logged into Relay.',
      });
    }
    await setState({ prompts });
  } catch (err) {
    log('refreshOpenTabs failed', err);
  }
}

async function storeRawCapture(entry) {
  const stored = await chrome.storage.local.get([RAW_CAPTURES_KEY]);
  const list = Array.isArray(stored[RAW_CAPTURES_KEY]) ? stored[RAW_CAPTURES_KEY] : [];
  list.push(entry);
  while (list.length > MAX_RAW_CAPTURES) list.shift();
  await chrome.storage.local.set({ [RAW_CAPTURES_KEY]: list });
}

/**
 * Passive capture path (user browsing) + template seed.
 * Scheduled sync also posts captures via MAIN safePost.
 */
async function handleCapture(msg) {
  try {
    const state = await getState();
    // Seed template even before LIVE so GO LIVE can start immediately
    const url = String(msg.url || '');
    if (!url.includes('/api/tours/entitiesV2')) return;

    const requestBody = msg.requestBody || null;
    const headers = stripCookieHeaders(msg.requestHeaders || {});
    const data = sanitizeCaptureJson(msg.data);
    const capturedAt = msg.capturedAt || new Date().toISOString();
    const tab = requestBody?.tileCountTab || '?';

    if (requestBody && typeof requestBody === 'object') {
      const existing = await getRequestTemplate();
      if (!existing?.body) {
        await saveRequestTemplate(requestBody, headers, {
          at: capturedAt,
          pageUrl: msg.pageUrl || null,
        });
        log('request template seeded from capture', tab);
        if (state.live) void alwaysOnTick({ force: true });
      } else {
        // Refresh headers/body from latest successful capture
        await saveRequestTemplate(requestBody, headers, {
          at: capturedAt,
          pageUrl: msg.pageUrl || null,
        });
      }
    }

    if (!state.live || !state.loggedIn) return;

    await storeRawCapture({
      url,
      timestamp: capturedAt,
      requestBody,
      json: data,
      pageUrl: msg.pageUrl || null,
    });

    // Clear auth pause on successful JSON capture
    if (state.health?.status === 'auth') {
      await setState({
        health: { status: 'healthy', message: '', pausedUntil: null },
      });
      await updateBadge();
    }

    const trips = extractTrips(url, data, requestBody);
    const stats = countTripStats(trips);
    log(`tab=${tab} trips=${stats.trips} legs=${stats.legs} stops=${stats.stops}`);

    await setState({
      lastCaptureAt: capturedAt,
      lastCaptureUrl: url.slice(0, 300),
      lastCaptureTab: tab,
      capturesSeen: (state.capturesSeen || 0) + 1,
      hasRequestTemplate: true,
    });

    // Passive path: treat as soft ingest without removing snapshot logic
    // (always-on tick owns NEW/CHANGED/REMOVED). Still upsert new/changed by hash.
    if (!trips.length) return;

    const hashStore = await chrome.storage.local.get([TRIP_HASH_KEY]);
    const hashes = { ...(hashStore[TRIP_HASH_KEY] || {}) };
    const changedTrips = [];
    for (const trip of trips) {
      const payload = tripContentHashPayload(trip);
      const hash = await hashString(payload);
      const key = `${trip.tripId}::${trip.version ?? ''}`;
      if (hashes[key] === hash) continue;
      hashes[key] = hash;
      changedTrips.push(trip);
    }
    await chrome.storage.local.set({ [TRIP_HASH_KEY]: hashes });

    if (changedTrips.length) {
      await pushTripsImmediate(changedTrips, { reason: 'passive' });
    }
  } catch (err) {
    log('handleCapture error', err);
  }
}

async function handleTripsDiff(diff) {
  const { tileCountTab, newTrips, changedTrips, removedTripIds, trips, snapshot, catchUp } = diff;
  const toPush = [...newTrips, ...changedTrips];

  // Always send full section trip payloads + optional snapshot to new CRM model
  if ((trips && trips.length) || snapshot) {
    const json = await pushTripsModelImmediate(trips || toPush, snapshot, tileCountTab, {
      catchUp: Boolean(catchUp),
    });
    if (json?.live_missing?.length) {
      const prev = (await getState()).pendingCatchUpMissing || [];
      await setState({
        pendingCatchUpMissing: [
          ...new Set([...prev, ...json.live_missing.map((id) => String(id).toUpperCase())]),
        ],
      });
    }
  } else if (toPush.length) {
    await pushTripsImmediate(toPush, {
      reason: 'always-on',
      tileCountTab,
      changeKinds: {
        newIds: new Set(newTrips.map((t) => t.tripId)),
        changedIds: new Set(changedTrips.map((t) => t.tripId)),
      },
    });
  }

  if (removedTripIds?.length && !catchUp) {
    await handleRemovedTrips(tileCountTab, removedTripIds);
  }

  await updateBadge();
}

async function postRelaySnapshot(body, extensionApiKey, label) {
  const res = await withTimeout(
    fetch(RELAY_SNAPSHOT_FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        'X-Relay-Extension-Key': extensionApiKey,
      },
      body: JSON.stringify(body),
    }),
    FLUSH_TIMEOUT_MS,
    label,
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json;
}

async function beginCatchUpOnEdge(missingTripIds) {
  const state = await getState();
  if (!state.extensionApiKey) {
    return {
      missingTripIds,
      untilIso: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    };
  }
  try {
    const json = await postRelaySnapshot(
      { action: 'begin_catch_up', missingTripIds },
      state.extensionApiKey,
      'begin_catch_up',
    );
    return {
      missingTripIds: json.catch_up?.missing_trip_ids || missingTripIds,
      untilIso: json.catch_up?.catch_up_until || null,
    };
  } catch (err) {
    log('beginCatchUpOnEdge failed', err?.message || err);
    return {
      missingTripIds,
      untilIso: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    };
  }
}

async function finalizeCatchUpOnEdge() {
  const state = await getState();
  if (!state.extensionApiKey) return;
  try {
    await postRelaySnapshot(
      { action: 'finalize_catch_up' },
      state.extensionApiKey,
      'finalize_catch_up',
    );
  } catch (err) {
    log('finalizeCatchUpOnEdge failed', err?.message || err);
  }
}

/** UPSERT relay_trips/legs/stops (+ snapshot) via relay-snapshot; loads via relay-sync. */
async function pushTripsModelImmediate(trips, snapshot, tileCountTab, opts = {}) {
  const state = await getState();
  if (!state.live || !state.extensionApiKey) return null;

  const edgeTrips = await tripsToEdgePayload(trips);
  const loads = tripsToCrmLoads(trips);
  const clientId = await ensureClientId();

  try {
    const json = await postRelaySnapshot(
      {
        client_id: clientId,
        trips: edgeTrips,
        catchUp: Boolean(opts.catchUp),
        ...(snapshot ? { snapshot } : {}),
      },
      state.extensionApiKey,
      `relay-snapshot ${tileCountTab || ''}${opts.catchUp ? ' catch-up' : ''}`,
    );
    if (json.section_counts) {
      await setState({
        sectionCounts: {
          ...(state.sectionCounts || {}),
          ...json.section_counts,
        },
        lastSyncAt: new Date().toISOString(),
      });
    }
    // Legacy loads path for existing CRM UI (legs as loads with parent_trip_id)
    if (loads.length) {
      await ingestCollection({ section: 'tours', loads, detail_detected: true });
      void flushToEdge();
    }
    await updateSection('tours', {
      state: 'Synced',
      lastError: null,
      lastCollectedAt: new Date().toISOString(),
    });
    return json;
  } catch (err) {
    const friendly = `CRM push failed: ${err?.message || err}`;
    log(friendly);
    const st = await getState();
    await setState({
      syncErrors: [
        ...(st.syncErrors || []).slice(-19),
        { at: new Date().toISOString(), error: friendly },
      ],
    });
    await updateSection('tours', {
      state: 'Error',
      lastError: friendly,
    });
    if (loads.length) {
      await ingestCollection({ section: 'tours', loads, detail_detected: true });
    }
    const delay = flushBackoffMs;
    flushBackoffMs = Math.min(FLUSH_BACKOFF_MAX_MS, flushBackoffMs * 2);
    setTimeout(() => void flushToEdge(), delay);
    return null;
  }
}

async function handleRemovedTrips(tileCountTab, removedTripIds) {
  // Only demote when removed from an active board
  if (tileCountTab !== 'IN_TRANSIT' && tileCountTab !== 'UPCOMING') return;

  const state = await getState();
  const pendingLoads = { ...state.pendingLoads };
  const loads = [];

  for (const tripId of removedTripIds) {
    // Find pending loads for this parent or id
    for (const [loadId, row] of Object.entries(pendingLoads)) {
      const match =
        loadId === tripId ||
        row.parent_trip_id === tripId ||
        row.load_id === tripId;
      if (!match) continue;
      // If still present on the other active board, skip demotion
      // (snapshot of other board is checked loosely via trip_bucket)
      const updated = {
        ...row,
        load_status: 'Completed',
        trip_bucket: 'history',
        notes: [row.notes, `removed_from:${tileCountTab}`].filter(Boolean).join(' · '),
        force_history_upsert: true,
        observed_at: new Date().toISOString(),
      };
      pendingLoads[loadId] = updated;
      loads.push(updated);
    }

    // Ensure at least a stub for the trip id itself
    if (isValidRelayLoadId(tripId) && !pendingLoads[tripId]) {
      const stub = {
        load_id: tripId,
        load_status: 'Completed',
        trip_bucket: 'history',
        pickup_location: null,
        delivery_location: null,
        notes: `removed_from:${tileCountTab}`,
        force_history_upsert: true,
        source: 'relay_entitiesV2_removed',
        observed_at: new Date().toISOString(),
      };
      pendingLoads[tripId] = stub;
      loads.push(stub);
    }
  }

  if (!loads.length) return;
  await setState({ pendingLoads });
  await ingestCollection({ section: 'tours', loads });
  void flushToEdge();
}

async function pushTripsImmediate(trips, meta = {}) {
  const loads = tripsToCrmLoads(trips).map((l) => {
    if (meta.changeKinds?.newIds?.has(l.parent_trip_id) || meta.changeKinds?.newIds?.has(l.load_id)) {
      return { ...l, change_kind: 'NEW' };
    }
    if (
      meta.changeKinds?.changedIds?.has(l.parent_trip_id) ||
      meta.changeKinds?.changedIds?.has(l.load_id)
    ) {
      return { ...l, change_kind: 'CHANGED' };
    }
    return l;
  });
  if (!loads.length) return;

  const st = await getState();
  await setState({
    tripsExtracted: (st.tripsExtracted || 0) + trips.length,
    syncProgress: {
      ...st.syncProgress,
      phase: 'flushing',
      detail: `${meta.reason || 'sync'}: pushing ${loads.length} load(s) immediately.`,
      percent: 70,
    },
  });
  await updateSection('tours', {
    state: 'Collecting',
    lastError: null,
    lastCollectedAt: new Date().toISOString(),
  });
  if (loads.some((l) => l.trailer_id || l.tractor_id)) {
    await updateSection('load_detail', {
      state: 'Collecting',
      lastError: null,
      lastCollectedAt: new Date().toISOString(),
    });
  }

  await ingestCollection({
    section: 'tours',
    loads,
    detail_detected: loads.some((l) => l.trailer_id || l.tractor_id || l.arrival_address),
  });

  const activeIds = loads
    .filter((l) => l.trip_bucket === 'upcoming' || l.trip_bucket === 'in_transit')
    .map((l) => l.load_id)
    .filter(Boolean);
  if (activeIds.length) {
    const prev = (await getState()).lastActiveLoadIds || [];
    await setState({ lastActiveLoadIds: [...new Set([...prev, ...activeIds])] });
  }

  void flushToEdge();
}

async function ingestCollection(data) {
  const state = await getState();
  const pendingLoads = { ...state.pendingLoads };
  const pendingPayments = { ...state.pendingPayments };
  let collected = state.recordsCollected;

  if (data.section === 'payments') {
    for (const payment of data.payments || []) {
      if (!isCompletePayment(payment) && !payment.payment_status) continue;
      const key = payment.reference_id || payment.amazon_ref_id || payment.load_id;
      if (!key) continue;
      pendingPayments[key] = {
        ...pendingPayments[key],
        ...payment,
        observed_at: new Date().toISOString(),
      };
      collected += 1;
    }
    const hasAny = Object.keys(pendingPayments).length > 0;
    await updateSection('payments', {
      state: hasAny ? 'Collecting' : 'Waiting for page',
      lastError: hasAny ? null : 'No payment data yet',
      lastCollectedAt: hasAny ? new Date().toISOString() : null,
    });
  } else {
    for (const load of data.loads || []) {
      if (!load.load_id || !isValidRelayLoadId(load.load_id)) continue;
      const prev = pendingLoads[load.load_id] || {};
      const merged = {
        ...prev,
        ...Object.fromEntries(Object.entries(load).filter(([, v]) => v != null && v !== '')),
        observed_at: new Date().toISOString(),
      };
      const badPlace = (v) => !isGoodLocation(v);
      if (badPlace(merged.pickup_location) && prev.pickup_location && !badPlace(prev.pickup_location)) {
        merged.pickup_location = prev.pickup_location;
      }
      if (
        badPlace(merged.delivery_location) &&
        prev.delivery_location &&
        !badPlace(prev.delivery_location)
      ) {
        merged.delivery_location = prev.delivery_location;
      }
      const nextDriver = sanitizeDriverName(merged.driver_name_raw);
      const prevDriver = sanitizeDriverName(prev.driver_name_raw);
      merged.driver_name_raw = nextDriver || prevDriver || null;
      if (merged.load_status && !mapLoadStatus(merged.load_status)) {
        // keep raw; finalizeLoadForSync maps buckets
      }
      pendingLoads[load.load_id] = merged;
      collected += 1;
    }
    const sectionLoads = data.loads || [];
    const hasRows = sectionLoads.length > 0;
    await updateSection(data.section || 'tours', {
      state: hasRows ? 'Collecting' : 'Waiting for page',
      lastError: hasRows ? null : 'No trips yet',
      lastCollectedAt: hasRows ? new Date().toISOString() : null,
    });
    if (data.detail_detected) {
      await updateSection('load_detail', {
        state: 'Collecting',
        lastError: null,
        lastCollectedAt: new Date().toISOString(),
      });
    }
  }

  await setState({ pendingLoads, pendingPayments, recordsCollected: collected });
}

async function postRelaySyncBatch(body, extensionApiKey, timeoutMs, label) {
  const res = await withTimeout(
    fetch(RELAY_SYNC_FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        'X-Relay-Extension-Key': extensionApiKey,
      },
      body: JSON.stringify(body),
    }),
    timeoutMs,
    label,
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json;
}

async function flushToEdge() {
  if (flushRunning) return;
  flushRunning = true;
  try {
    const state = await getState();
    if (!state.live || !state.extensionApiKey) return;

    const cache = { ...(state.syncedLoadCache || {}) };
    const loads = [];
    for (const raw of Object.values((await getState()).pendingLoads)) {
      if (!isCompleteLoad(raw) && !raw.force_history_upsert) continue;
      const load = finalizeLoadForSync(raw);
      if (!load) continue;
      if (!isCompleteLoad(load) && !raw.force_history_upsert) continue;
      const content_hash = await hashLoadPayload(load);

      if (
        !raw.force_history_upsert &&
        (load.trip_bucket === 'history' ||
          /^(Completed|Delivered|Cancelled|Rejected)$/i.test(load.load_status || ''))
      ) {
        const prev = cache[load.load_id];
        if (
          prev &&
          prev.trip_bucket === 'history' &&
          prev.load_status === load.load_status &&
          (prev.payment_status || 'Not Received') === (load.payment_status || 'Not Received') &&
          prev.content_hash === content_hash
        ) {
          continue;
        }
      }

      loads.push({
        ...load,
        content_hash,
        payment_status: load.payment_status || 'Not Received',
        driver_name_raw: sanitizeDriverName(load.driver_name_raw),
      });
    }

    const latest = await getState();
    const payments = Object.values(latest.pendingPayments).filter(
      (p) => isCompletePayment(p) || (p.load_id && p.payment_status),
    );

    if (!loads.length && !payments.length) {
      for (const id of ['tours', 'load_detail', 'payments']) {
        if (latest.sections[id]?.state === 'Collecting' && latest.sections[id]?.lastCollectedAt) {
          await updateSection(id, { state: 'Synced', lastError: null });
        }
      }
      flushBackoffMs = FLUSH_BACKOFF_BASE_MS;
      return;
    }

    const clientId = await ensureClientId();
    const batchSize = Math.max(5, FLUSH_BATCH_SIZE || 20);
    const orderedLoads = [...loads].sort((a, b) => {
      const rank = (l) =>
        l.trip_bucket === 'in_transit' ? 0 : l.trip_bucket === 'upcoming' ? 1 : 2;
      return rank(a) - rank(b);
    });
    const loadChunks = [];
    for (let i = 0; i < orderedLoads.length; i += batchSize) {
      loadChunks.push(orderedLoads.slice(i, i + batchSize));
    }
    if (!loadChunks.length && payments.length) loadChunks.push([]);

    let remainingLoads = { ...latest.pendingLoads };
    let remainingPayments = { ...latest.pendingPayments };
    const nextCache = { ...(latest.syncedLoadCache || {}) };
    let recordsUpdated = latest.recordsUpdated;
    let recordsInserted = latest.recordsInserted;
    let syncErrors = [...(latest.syncErrors || [])];
    let anySuccess = false;
    let lastErr = null;
    const allNotifications = [];

    for (let i = 0; i < loadChunks.length; i += 1) {
      const chunk = loadChunks[i];
      const isLast = i === loadChunks.length - 1;
      const batchLabel = `CRM flush batch ${i + 1}/${loadChunks.length} (${chunk.length} loads)`;

      const body = {
        client_id: clientId,
        loads: chunk,
        payments: isLast ? payments : [],
        section_states: (await getState()).sections,
        observed_at: new Date().toISOString(),
      };

      try {
        const json = await postRelaySyncBatch(
          body,
          latest.extensionApiKey,
          FLUSH_TIMEOUT_MS,
          batchLabel,
        );
        anySuccess = true;
        flushBackoffMs = FLUSH_BACKOFF_BASE_MS;
        for (const id of json.synced_load_ids || []) delete remainingLoads[id];
        for (const id of json.synced_payment_refs || []) delete remainingPayments[id];
        if (isLast && payments.length) {
          for (const p of payments) {
            const key = p.reference_id || p.amazon_ref_id || p.load_id;
            if (key) delete remainingPayments[key];
          }
        }
        for (const load of chunk) {
          if (!load.load_id) continue;
          nextCache[load.load_id] = {
            trip_bucket: load.trip_bucket || null,
            load_status: load.load_status || null,
            payment_status: load.payment_status || null,
            content_hash: load.content_hash || null,
            at: Date.now(),
          };
        }
        recordsUpdated +=
          (json.loads_updated || 0) +
          (json.payments_upserted || 0) +
          (json.loads_reconciled || 0);
        recordsInserted += json.loads_inserted || 0;
        if (json.errors?.length) {
          syncErrors = [
            ...syncErrors.slice(-15),
            ...json.errors.map((e) => ({ at: new Date().toISOString(), error: e })),
          ];
        }
        for (const n of json.notifications || []) allNotifications.push(n);
      } catch (err) {
        lastErr = err;
        const friendly = `CRM push failed: batch ${i + 1}/${loadChunks.length}: ${err?.message || err}`;
        syncErrors = [...syncErrors.slice(-19), { at: new Date().toISOString(), error: friendly }];
        await setState({
          pendingLoads: remainingLoads,
          pendingPayments: remainingPayments,
          syncedLoadCache: nextCache,
          recordsUpdated,
          recordsInserted,
          syncErrors,
        });
        await maybeNotifyTelegram({
          event_type: 'sync_error',
          dedupe_key: `sync_error:${friendly}`.slice(0, 180),
          message: `Relay sync error: ${friendly}`,
        });
        const delay = flushBackoffMs;
        flushBackoffMs = Math.min(FLUSH_BACKOFF_MAX_MS, flushBackoffMs * 2);
        setTimeout(() => void flushToEdge(), delay);
        break;
      }
    }

    for (const [id, raw] of Object.entries(remainingLoads)) {
      if (raw?.trip_bucket === 'history' && nextCache[id]?.trip_bucket === 'history') {
        const age = Date.now() - (nextCache[id].at || 0);
        if (age < HISTORY_SKIP_TTL_MS && !raw.force_history_upsert) delete remainingLoads[id];
      }
    }

    await setState({
      pendingLoads: remainingLoads,
      pendingPayments: remainingPayments,
      syncedLoadCache: nextCache,
      lastSyncAt: anySuccess ? new Date().toISOString() : latest.lastSyncAt,
      recordsUpdated,
      recordsInserted,
      syncErrors,
    });

    if (anySuccess && !lastErr) {
      const syncedSections = new Set();
      if (loads.length) {
        syncedSections.add('tours');
        if (loads.some((l) => l.trailer_id || l.tractor_id)) syncedSections.add('load_detail');
      }
      if (payments.length) syncedSections.add('payments');
      for (const id of syncedSections) {
        await updateSection(id, {
          state: 'Synced',
          lastError: null,
          lastCollectedAt: new Date().toISOString(),
        });
      }
      await setState({
        syncProgress: {
          ...(await getState()).syncProgress,
          phase: 'always-on',
          detail: `Synced ${loads.length} load(s). Always-on listening…`,
          percent: 100,
        },
      });
    } else if (lastErr) {
      const friendly =
        syncErrors[syncErrors.length - 1]?.error || String(lastErr?.message || lastErr);
      for (const section of ['tours', 'load_detail', 'payments']) {
        if (latest.sections[section]?.state === 'Collecting') {
          await updateSection(section, { state: 'Error', lastError: friendly });
        }
      }
    }

    for (const n of allNotifications) {
      await maybeNotifyTelegram(n);
    }
  } finally {
    flushRunning = false;
  }
}

async function maybeNotifyTelegram(event) {
  const state = await getState();
  if (!state.extensionApiKey || !event?.message) return;
  try {
    await fetch(RELAY_TELEGRAM_FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        'X-Relay-Extension-Key': state.extensionApiKey,
      },
      body: JSON.stringify(event),
    });
  } catch {
    /* non-fatal */
  }
}

void SECTIONS;
void SCHEDULE_MIN;
void ENTITIES_V2_URL;
