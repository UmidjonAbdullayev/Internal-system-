import {
  RELAY_SYNC_FN,
  RELAY_TELEGRAM_FN,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  SECTIONS,
  TAB_SCAN_ALARM,
  SYNC_ALARM,
  isTripsBoardUrl,
  DETAIL_SCRAPE_TTL_MS,
  EXPAND_DELAY_MS,
  EXPAND_COLLAPSE_DELAY_MS,
  MAX_EXPAND_PER_SCAN,
} from '../shared/config.js';
import { getState, setState, updateSection, ensureClientId } from '../shared/state.js';
import {
  hashLoadPayload,
  isCompleteLoad,
  isCompletePayment,
  finalizeLoadForSync,
  isValidRelayLoadId,
} from '../shared/normalize.js';

const RELAY_HOST_RE = /^https:\/\/([a-z0-9-]+\.)?relay\.amazon\.com\//i;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureClientId();
  await chrome.alarms.create(TAB_SCAN_ALARM, { periodInMinutes: 0.5 });
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const state = await getState();
  if (!state.live || !state.loggedIn) return;
  if (alarm.name === TAB_SCAN_ALARM) await scanTabsAndCollect();
  if (alarm.name === SYNC_ALARM) await flushToEdge();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
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
      sendResponse({ ok: true, state: await setState({ extensionApiKey: msg.extensionApiKey || '' }) });
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
        sendResponse({ ok: false, error: 'Set Extension API key (RELAY_EXTENSION_API_KEY) first' });
        return;
      }
      const next = await setState({
        live: true,
        syncErrors: [],
        prompts: [],
        collectionLocks: {},
        sections: {
          tours: { state: 'Not checked', lastError: null, lastCollectedAt: null },
          load_detail: { state: 'Not checked', lastError: null, lastCollectedAt: null },
          payments: { state: 'Not checked', lastError: null, lastCollectedAt: null },
        },
      });
      await scanTabsAndCollect();
      await flushToEdge();
      sendResponse({ ok: true, state: await getState() });
      return;
    }
    if (msg?.type === 'STOP') {
      sendResponse({ ok: true, state: await setState({ live: false }) });
      return;
    }
    if (msg?.type === 'FORCE_SCAN') {
      await scanTabsAndCollect();
      await flushToEdge();
      sendResponse({ ok: true, state: await getState() });
      return;
    }
    if (msg?.type === 'GET_DETAIL_SCRAPED') {
      const state = await getState();
      const now = Date.now();
      const fresh = {};
      for (const [id, meta] of Object.entries(state.detailScraped || {})) {
        if (meta?.at && now - meta.at < DETAIL_SCRAPE_TTL_MS) fresh[id] = meta;
      }
      if (Object.keys(fresh).length !== Object.keys(state.detailScraped || {}).length) {
        await setState({ detailScraped: fresh });
      }
      sendResponse({ ok: true, detailScraped: fresh });
      return;
    }
    if (msg?.type === 'MARK_DETAIL_SCRAPED') {
      const state = await getState();
      const next = { ...(state.detailScraped || {}) };
      for (const row of msg.rows || []) {
        if (!row?.load_id) continue;
        const prev = next[row.load_id] || {};
        next[row.load_id] = {
          at: Date.now(),
          hasTrailer: Boolean(row.trailer_id) || Boolean(prev.hasTrailer),
          hasTractor: Boolean(row.tractor_id) || Boolean(prev.hasTractor),
          trailer_id: row.trailer_id || prev.trailer_id || null,
          tractor_id: row.tractor_id || prev.tractor_id || null,
          notes: row.notes || prev.notes || null,
        };
      }
      await setState({ detailScraped: next });
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: 'Unknown message' });
  })();
  return true;
});

async function listRelayTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((t) => t.url && RELAY_HOST_RE.test(t.url) && t.id != null);
}

function matchSectionForUrl(url) {
  const lower = String(url || '').toLowerCase();
  if (/payment|settlement|invoice/.test(lower)) return 'payments';
  // Trips board paths (/trips, /trips/in-transit, …) are always Tours — never Load detail
  if (isTripsBoardUrl(lower)) return 'tours';
  for (const section of SECTIONS) {
    if (section.urlHints.some((h) => lower.includes(h.toLowerCase()))) return section.id;
  }
  return null;
}

async function scanTabsAndCollect() {
  const state = await getState();
  if (!state.live) return;

  const tabs = await listRelayTabs();
  await setState({
    openTabs: tabs.map((t) => ({ id: t.id, url: t.url, title: t.title })),
  });

  const seenSections = new Set();
  for (const tab of tabs) {
    const hinted = matchSectionForUrl(tab.url);
    if (hinted) seenSections.add(hinted);

    const lockKey = `tab:${tab.id}`;
    if (state.collectionLocks[lockKey]) continue;

    await setState({
      collectionLocks: { ...state.collectionLocks, [lockKey]: Date.now() },
    });
    try {
      if (hinted) await updateSection(hinted, { state: 'Waiting for page' });
      const result = await collectFromTab(tab.id, { allTripTabs: true });
      if (!result?.ok) {
        if (hinted) {
          await updateSection(hinted, {
            state: 'Error',
            lastError: result?.error || 'Collect failed',
          });
        }
        continue;
      }
      const data = result.data;
      if (!data.section) continue;
      // Content may still label a Trips board as load_detail — coerce for status UI
      if (
        data.section === 'load_detail' &&
        (isTripsBoardUrl(tab.url) || (data.loads || []).some((l) => /^T-/i.test(l.load_id || '')))
      ) {
        data.section = 'tours';
      }
      seenSections.add(data.section);
      if (data.section === 'tours' || (data.loads || []).length) {
        seenSections.add('tours');
      }
      await updateSection(data.section, { state: 'Collecting', lastError: null });
      if (data.section === 'tours') {
        await updateSection('tours', { state: 'Collecting', lastError: null });
      }
      await ingestCollection(data);
    } finally {
      const latest = await getState();
      const locks = { ...latest.collectionLocks };
      delete locks[lockKey];
      await setState({ collectionLocks: locks });
    }
  }

  await promptMissingSections(seenSections);
}

async function collectFromTab(tabId, opts = {}) {
  const payload = {
    type: 'RELAY_COLLECT',
    allTripTabs: opts.allTripTabs !== false,
    maxExpand: opts.maxExpand ?? MAX_EXPAND_PER_SCAN,
    expandDelayMs: opts.expandDelayMs ?? EXPAND_DELAY_MS,
    collapseDelayMs: opts.collapseDelayMs ?? EXPAND_COLLAPSE_DELAY_MS,
  };
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/relay-collector.js'],
      });
      return await chrome.tabs.sendMessage(tabId, payload);
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

async function ingestCollection(data) {
  const state = await getState();
  const pendingLoads = { ...state.pendingLoads };
  const pendingPayments = { ...state.pendingPayments };
  let collected = state.recordsCollected;

  if (data.section === 'payments') {
    for (const payment of data.payments || []) {
      if (!isCompletePayment(payment) && !payment.payment_status) {
        continue;
      }
      const key = payment.reference_id || payment.amazon_ref_id || payment.load_id;
      if (!key) continue;
      pendingPayments[key] = {
        ...pendingPayments[key],
        ...payment,
        observed_at: new Date().toISOString(),
      };
      collected += 1;

      // Payment status can update matching load rows (only real trip/leg IDs)
      if (payment.load_id || payment.amazon_ref_id) {
        const loadKey = payment.load_id || payment.amazon_ref_id;
        if (loadKey && isValidRelayLoadId(loadKey)) {
          pendingLoads[loadKey] = {
            ...(pendingLoads[loadKey] || { load_id: loadKey }),
            payment_status: payment.payment_status || pendingLoads[loadKey]?.payment_status,
            payment_date: payment.payment_date || pendingLoads[loadKey]?.payment_date,
            observed_at: new Date().toISOString(),
          };
        }
      }
    }
    const hasAny = Object.keys(pendingPayments).length > 0;
    await updateSection('payments', {
      state: hasAny ? 'Collecting' : 'Error',
      lastError: hasAny ? null : 'No payment rows detected on page',
      lastCollectedAt: hasAny ? new Date().toISOString() : null,
    });
  } else {
    for (const load of data.loads || []) {
      if (!load.load_id || !isValidRelayLoadId(load.load_id)) continue;
      const prev = pendingLoads[load.load_id] || {};
      pendingLoads[load.load_id] = {
        ...prev,
        ...Object.fromEntries(
          Object.entries(load).filter(([, v]) => v != null && v !== '')
        ),
        observed_at: new Date().toISOString(),
      };
      collected += 1;
    }
    const sectionLoads = data.loads || [];
    const completeCount = sectionLoads.filter(isCompleteLoad).length;
    const hasRows = sectionLoads.length > 0;
    await updateSection(data.section, {
      state: hasRows ? 'Collecting' : 'Error',
      lastError: hasRows
        ? completeCount === 0
          ? 'Rows found but required CRM fields incomplete'
          : null
        : 'No load rows detected — open Trips (Upcoming / In Transit / History). Extension auto-expands rows for trailer/stop detail when needed.',
      lastCollectedAt: hasRows ? new Date().toISOString() : null,
    });

    // Expanded trip detail (trailer/equipment) often lives on the same /trips URL
    const detailLoads = sectionLoads.filter((l) => l.trailer_id || l.section === 'load_detail');
    if (data.detail_detected || detailLoads.length) {
      await updateSection('load_detail', {
        state: 'Collecting',
        lastError: null,
        lastCollectedAt: new Date().toISOString(),
      });
    }
  }

  await setState({ pendingLoads, pendingPayments, recordsCollected: collected });
}

async function promptMissingSections(seenSections) {
  const state = await getState();
  const prompts = [];
  // Open Trips board tab counts as tours even if content script was slow
  const hasTripsTab = (state.openTabs || []).some((t) => isTripsBoardUrl(t.url));
  if (hasTripsTab) seenSections.add('tours');

  for (const section of SECTIONS.filter((s) => s.required)) {
    const st = state.sections[section.id]?.state;
    if (!seenSections.has(section.id) && st !== 'Synced' && st !== 'Collecting') {
      const message =
        section.id === 'payments'
          ? 'Payment information not detected. Please open the Payments page.'
          : section.id === 'tours'
            ? 'Tours / Trips not detected. Open Amazon Relay → Trips (Upcoming, In Transit, or History). One tab is enough — the extension auto-clicks those in-page tabs.'
            : `${section.label} not detected. Please open the corresponding Amazon Relay page.`;
      prompts.push({ sectionId: section.id, message });
      if (st === 'Not checked' || st === 'Synced' || st === 'Waiting for page') {
        await updateSection(section.id, { state: 'Waiting for page' });
      }
      await maybeNotifyTelegram({
        event_type: 'missing_page',
        dedupe_key: `missing:${section.id}:${new Date().toISOString().slice(0, 13)}`,
        message,
      });
    }
  }
  await setState({ prompts });
}

async function flushToEdge() {
  const state = await getState();
  if (!state.live || !state.extensionApiKey) return;

  const loads = [];
  for (const raw of Object.values(state.pendingLoads)) {
    if (!isCompleteLoad(raw)) continue;
    const load = finalizeLoadForSync(raw);
    if (!load || !isCompleteLoad(load)) continue;
    const content_hash = await hashLoadPayload(load);
    loads.push({ ...load, content_hash, payment_status: load.payment_status || 'Not Received' });
  }
  const payments = Object.values(state.pendingPayments).filter(
    (p) => isCompletePayment(p) || (p.load_id && p.payment_status)
  );

  if (!loads.length && !payments.length) return;

  const clientId = await ensureClientId();
  const body = {
    client_id: clientId,
    loads,
    payments,
    section_states: state.sections,
    observed_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(RELAY_SYNC_FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        'X-Relay-Extension-Key': state.extensionApiKey,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      const err = json.error || `HTTP ${res.status}`;
      await setState({
        syncErrors: [...(state.syncErrors || []).slice(-19), { at: new Date().toISOString(), error: err }],
      });
      await maybeNotifyTelegram({
        event_type: 'sync_error',
        dedupe_key: `sync_error:${err}`.slice(0, 180),
        message: `Relay sync error: ${err}`,
      });
      for (const section of ['tours', 'load_detail', 'payments']) {
        if (state.sections[section]?.state === 'Collecting') {
          await updateSection(section, { state: 'Error', lastError: err });
        }
      }
      return;
    }

    const syncedSections = new Set();
    if (json.loads_inserted || json.loads_updated) {
      syncedSections.add('tours');
      if (loads.some((l) => l.section === 'load_detail' || l.trailer_id || l.additional_charges != null)) {
        syncedSections.add('load_detail');
      }
    }
    if (json.payments_upserted || payments.length) {
      if (json.payments_upserted > 0 || json.loads_payment_updated > 0) syncedSections.add('payments');
    }

    for (const id of syncedSections) {
      await updateSection(id, { state: 'Synced', lastError: null, lastCollectedAt: new Date().toISOString() });
    }

    // Clear successfully written pending items
    const remainingLoads = { ...state.pendingLoads };
    for (const id of json.synced_load_ids || []) delete remainingLoads[id];
    const remainingPayments = { ...state.pendingPayments };
    for (const id of json.synced_payment_refs || []) delete remainingPayments[id];

    await setState({
      pendingLoads: remainingLoads,
      pendingPayments: remainingPayments,
      lastSyncAt: new Date().toISOString(),
      recordsUpdated: state.recordsUpdated + (json.loads_updated || 0) + (json.payments_upserted || 0),
      recordsInserted: state.recordsInserted + (json.loads_inserted || 0),
      syncErrors: json.errors?.length
        ? [...(state.syncErrors || []).slice(-15), ...json.errors.map((e) => ({ at: new Date().toISOString(), error: e }))]
        : state.syncErrors,
    });

    for (const n of json.notifications || []) {
      await maybeNotifyTelegram(n);
    }
  } catch (err) {
    await setState({
      syncErrors: [...(state.syncErrors || []).slice(-19), { at: new Date().toISOString(), error: String(err) }],
    });
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
    // Non-fatal — sync path remains primary
  }
}
