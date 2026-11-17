import {
  RELAY_SYNC_FN,
  RELAY_TELEGRAM_FN,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  SECTIONS,
  SYNC_ALARM,
  CAPTURE_FLUSH_ALARM,
  DEBUG,
  MAX_RAW_CAPTURES,
  CAPTURE_BATCH_MS,
  CAPTURE_BATCH_SIZE,
  SYNC_FLUSH_MINUTES,
  FLUSH_TIMEOUT_MS,
  FLUSH_BATCH_SIZE,
  FLUSH_BACKOFF_BASE_MS,
  FLUSH_BACKOFF_MAX_MS,
  TYPICAL_FULL_SYNC_SECONDS,
  RAW_CAPTURES_KEY,
  TRIP_HASH_KEY,
  LAST_ENTITIES_REQ_KEY,
  ENTITIES_V2_URL,
  HISTORY_PAGE_SIZE,
  HISTORY_MIN_INTERVAL_MS,
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
} from '../shared/normalize.js';
import { extractTrips, countTripStats, tripContentHashPayload, hashString } from '../shared/extract.js';
import { tripsToCrmLoads } from '../shared/map-to-crm.js';

const RELAY_HOST_RE = /^https:\/\/([a-z0-9-]+\.)?relay\.amazon\.com\//i;

let flushRunning = false;
let captureFlushTimer = null;
let pendingTripBatch = new Map(); // dedupeKey → trip
let flushBackoffMs = FLUSH_BACKOFF_BASE_MS;
let historySyncRunning = false;
let lastHistoryPageAt = 0;

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

function tripDedupeKey(trip) {
  return `${trip.tripId}::${trip.version ?? ''}`;
}

/** Strip phone/email from raw entity before storage (privacy). */
function sanitizeEntityForStorage(entity) {
  try {
    const clone = JSON.parse(JSON.stringify(entity));
    const scrubPerson = (p) => {
      if (!p || typeof p !== 'object') return p;
      const out = { firstName: p.firstName ?? null, lastName: p.lastName ?? null };
      return out;
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
    return {
      ...data,
      entities: data.entities.map(sanitizeEntityForStorage),
    };
  } catch {
    return data;
  }
}

async function ensureAlarms() {
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_FLUSH_MINUTES });
  await chrome.alarms.create(CAPTURE_FLUSH_ALARM, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureClientId();
  flushRunning = false;
  await setState({ scanInProgress: false });
  await ensureAlarms();
});

chrome.runtime.onStartup?.addListener?.(async () => {
  flushRunning = false;
  await ensureAlarms();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const state = await getState();
  if (!state.live || !state.loggedIn) return;
  if (alarm.name === SYNC_ALARM || alarm.name === CAPTURE_FLUSH_ALARM) {
    scheduleCaptureFlush(0);
    void flushToEdge();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
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
        sendResponse({ ok: true, state: await setState({ loggedIn: false, live: false }) });
        return;
      }
      if (msg?.type === 'SET_API_KEY') {
        sendResponse({
          ok: true,
          state: await setState({ extensionApiKey: msg.extensionApiKey || '' }),
        });
        return;
      }
      if (msg?.type === 'SET_SYNC_ALL_HISTORY') {
        const next = await setState({ syncAllHistory: Boolean(msg.syncAllHistory) });
        sendResponse({ ok: true, state: next });
        if (next.live && next.syncAllHistory) void maybeSyncAllHistory();
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
        await setState({
          live: true,
          syncErrors: [],
          prompts: [],
          syncProgress: {
            phase: 'listening',
            detail:
              'Listening for POST /api/tours/entitiesV2. Browse Relay Trips tabs — no clicks needed.',
            percent: 10,
            startedAt: new Date().toISOString(),
            typicalSeconds: TYPICAL_FULL_SYNC_SECONDS,
            historyWeeks: [],
          },
        });
        await ensureAlarms();
        await refreshOpenTabs();
        sendResponse({ ok: true, state: await getState() });
        void flushToEdge();
        if ((await getState()).syncAllHistory) void maybeSyncAllHistory();
        return;
      }
      if (msg?.type === 'STOP') {
        flushRunning = false;
        pendingTripBatch.clear();
        sendResponse({
          ok: true,
          state: await setState({
            live: false,
            syncProgress: {
              phase: 'idle',
              detail: 'Stopped',
              percent: 0,
              typicalSeconds: TYPICAL_FULL_SYNC_SECONDS,
            },
          }),
        });
        return;
      }
      if (msg?.type === 'FORCE_SCAN') {
        await refreshOpenTabs();
        scheduleCaptureFlush(0);
        void flushToEdge();
        if ((await getState()).syncAllHistory) void maybeSyncAllHistory();
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
    const hasTrips = relayTabs.some((t) => isTripsBoardUrl(t.url));
    const hasPay = relayTabs.some((t) => /payment|settlement|invoice/i.test(t.url || ''));
    if (hasTrips) await updateSection('tours', { state: 'Collecting', lastError: null });
    const prompts = [];
    if (!hasTrips) {
      prompts.push({
        sectionId: 'tours',
        message:
          'Open Amazon Relay → Trips (Upcoming / In Transit / History). Extension captures entitiesV2 JSON only.',
      });
    }
    if (!hasPay) {
      prompts.push({
        sectionId: 'payments',
        message: 'Open Payments if you need settlement sync (separate from entitiesV2).',
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

async function handleCapture(msg) {
  try {
    const state = await getState();
    if (!state.live || !state.loggedIn) return;

    const url = String(msg.url || '');
    if (!url.includes('/api/tours/entitiesV2')) return;

    const requestBody = msg.requestBody || null;
    const data = sanitizeCaptureJson(msg.data);
    const capturedAt = msg.capturedAt || new Date().toISOString();
    const tab = requestBody?.tileCountTab || '?';

    await storeRawCapture({
      url,
      timestamp: capturedAt,
      requestBody,
      json: data,
      pageUrl: msg.pageUrl || null,
    });

    // Remember last request for optional History pagination (headers left to page-context fetch)
    if (requestBody && typeof requestBody === 'object') {
      await chrome.storage.local.set({
        [LAST_ENTITIES_REQ_KEY]: {
          body: requestBody,
          url: ENTITIES_V2_URL,
          at: capturedAt,
          pageUrl: msg.pageUrl || null,
        },
      });
    }

    const trips = extractTrips(url, data, requestBody);
    const stats = countTripStats(trips);
    log(`tab=${tab} trips=${stats.trips} legs=${stats.legs} stops=${stats.stops}`);

    await setState({
      lastCaptureAt: capturedAt,
      lastCaptureUrl: url.slice(0, 300),
      lastCaptureTab: tab,
      capturesSeen: (state.capturesSeen || 0) + 1,
    });

    if (!trips.length) return;

    const hashStore = await chrome.storage.local.get([TRIP_HASH_KEY]);
    const hashes = { ...(hashStore[TRIP_HASH_KEY] || {}) };
    let changed = 0;

    for (const trip of trips) {
      const key = tripDedupeKey(trip);
      const payload = tripContentHashPayload(trip);
      const hash = await hashString(payload);
      if (hashes[key] === hash) continue;
      hashes[key] = hash;
      pendingTripBatch.set(key, trip);
      changed += 1;
    }

    await chrome.storage.local.set({ [TRIP_HASH_KEY]: hashes });

    if (changed) {
      const st = await getState();
      await setState({
        tripsExtracted: (st.tripsExtracted || 0) + changed,
        syncProgress: {
          ...st.syncProgress,
          phase: 'capturing',
          detail: `entitiesV2 ${tab}: ${changed} new/changed trip(s); ${pendingTripBatch.size} pending.`,
          percent: Math.min(90, 20 + pendingTripBatch.size),
        },
      });
      await updateSection('tours', {
        state: 'Collecting',
        lastError: null,
        lastCollectedAt: new Date().toISOString(),
      });
      if (trips.some((t) => (t.legs || []).some((l) => l.trailerId || (l.stops || []).length))) {
        await updateSection('load_detail', {
          state: 'Collecting',
          lastError: null,
          lastCollectedAt: new Date().toISOString(),
        });
      }
      scheduleCaptureFlush(CAPTURE_BATCH_MS);
      if (pendingTripBatch.size >= CAPTURE_BATCH_SIZE) scheduleCaptureFlush(0);
    }

    // Kick optional history sync when we see a HISTORY page or setting is on
    if ((await getState()).syncAllHistory) {
      void maybeSyncAllHistory();
    }
  } catch (err) {
    log('handleCapture error', err);
  }
}

function scheduleCaptureFlush(delayMs) {
  if (captureFlushTimer) clearTimeout(captureFlushTimer);
  captureFlushTimer = setTimeout(() => {
    captureFlushTimer = null;
    void flushPendingTrips();
  }, Math.max(0, delayMs));
}

async function flushPendingTrips() {
  if (!pendingTripBatch.size) return;
  const batch = [...pendingTripBatch.values()];
  pendingTripBatch.clear();
  const loads = tripsToCrmLoads(batch);
  log(`flushing ${batch.length} trip(s) → ${loads.length} CRM load(s)`);
  if (!loads.length) return;
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
    await setState({ lastActiveLoadIds: [...new Set(activeIds)] });
  }
  void flushToEdge();
}

/**
 * Optional (default OFF): replay last captured POST with tileCountTab=HISTORY,
 * pagination.from += 100 until page returns < 100 entities. Max 1 req / 2s.
 * Runs via chrome.tabs.sendMessage → MAIN page fetch (same cookies/headers).
 */
async function maybeSyncAllHistory() {
  const state = await getState();
  if (!state.live || !state.syncAllHistory || historySyncRunning) return;
  historySyncRunning = true;
  try {
    const stored = await chrome.storage.local.get([LAST_ENTITIES_REQ_KEY]);
    const last = stored[LAST_ENTITIES_REQ_KEY];
    if (!last?.body) {
      log('history sync: no captured request body yet — browse Trips first');
      return;
    }

    const tabs = await chrome.tabs.query({});
    const relayTab = tabs.find((t) => t.url && RELAY_HOST_RE.test(t.url) && t.id != null);
    if (!relayTab) {
      log('history sync: no Relay tab for credentials');
      return;
    }

    let from = 0;
    let page = 0;
    for (;;) {
      const wait = Math.max(0, HISTORY_MIN_INTERVAL_MS - (Date.now() - lastHistoryPageAt));
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (!(await getState()).live || !(await getState()).syncAllHistory) break;

      const body = {
        ...last.body,
        tileCountTab: 'HISTORY',
        pagination: {
          ...(last.body.pagination || {}),
          size: HISTORY_PAGE_SIZE,
          from,
        },
      };

      lastHistoryPageAt = Date.now();
      page += 1;
      log(`history sync page ${page} from=${from}`);

      let result;
      try {
        result = await chrome.tabs.sendMessage(relayTab.id, {
          type: 'RELAY_FETCH_ENTITIES_V2',
          url: ENTITIES_V2_URL,
          body,
        });
      } catch (err) {
        log('history sync tab message failed', err?.message || err);
        break;
      }

      if (!result?.ok || !result.data) {
        log('history sync failed', result?.error || 'no data');
        break;
      }

      await handleCapture({
        url: ENTITIES_V2_URL,
        requestBody: body,
        data: result.data,
        capturedAt: new Date().toISOString(),
        pageUrl: relayTab.url,
      });

      const n = Array.isArray(result.data.entities) ? result.data.entities.length : 0;
      if (n < HISTORY_PAGE_SIZE) break;
      from += HISTORY_PAGE_SIZE;
      if (page > 50) {
        log('history sync safety stop at 50 pages');
        break;
      }
    }
  } finally {
    historySyncRunning = false;
  }
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
      pendingLoads[load.load_id] = merged;
      collected += 1;
    }
    const sectionLoads = data.loads || [];
    const hasRows = sectionLoads.length > 0;
    await updateSection(data.section || 'tours', {
      state: hasRows ? 'Collecting' : 'Waiting for page',
      lastError: hasRows ? null : 'No trips from entitiesV2 yet — open Trips tabs',
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

    if (pendingTripBatch.size) await flushPendingTrips();

    const cache = { ...(state.syncedLoadCache || {}) };
    const loads = [];
    for (const raw of Object.values((await getState()).pendingLoads)) {
      if (!isCompleteLoad(raw)) continue;
      const load = finalizeLoadForSync(raw);
      if (!load || !isCompleteLoad(load)) continue;
      const content_hash = await hashLoadPayload(load);

      if (
        load.trip_bucket === 'history' ||
        /^(Completed|Delivered|Cancelled|Rejected)$/i.test(load.load_status || '')
      ) {
        const prev = cache[load.load_id];
        if (
          prev &&
          prev.trip_bucket === 'history' &&
          prev.load_status === load.load_status &&
          (prev.payment_status || 'Not Received') === (load.payment_status || 'Not Received') &&
          prev.content_hash === content_hash &&
          !raw.force_history_upsert
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
      await setState({
        syncProgress: {
          ...(await getState()).syncProgress,
          phase: 'flushing',
          detail: `${batchLabel}…`,
          percent: Math.min(99, 90 + Math.round(((i + 1) / loadChunks.length) * 9)),
        },
      });

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
        const msg = String(err?.message || err);
        const friendly = /timed out/i.test(msg)
          ? `CRM flush timed out on batch ${i + 1}/${loadChunks.length}. Retry with backoff.`
          : `CRM flush failed on batch ${i + 1}/${loadChunks.length}: ${msg}`;
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
        if (age < HISTORY_SKIP_TTL_MS) delete remainingLoads[id];
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
          phase: 'listening',
          detail: `Synced ${loads.length} load(s). Listening for entitiesV2…`,
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
