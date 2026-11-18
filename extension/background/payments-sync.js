/**
 * Low-priority Relay financials sync (settlements + payments-summary).
 * Passive capture on Payments page + scheduled GET every 30 min.
 */

import {
  DEBUG,
  SETTLEMENTS_URL,
  PAYMENTS_SUMMARY_URL,
  PAYMENTS_SYNC_INTERVAL_MS,
  PAYMENTS_ALARM,
  RELAY_SYNC_FN,
  SUPABASE_ANON_KEY,
  FLUSH_TIMEOUT_MS,
} from '../shared/config.js';
import { getState, setState, updateSection, ensureClientId } from '../shared/state.js';
import {
  mapSettlementList,
  mapPaymentsSummary,
  mapSettlementToInvoice,
} from '../shared/payments-map.js';

function log(...args) {
  if (DEBUG) console.log('[RelayPayments]', ...args);
}

let syncRunning = false;
let hooks = {
  getSyncTabId: async () => null,
  sendToTab: async () => ({ ok: false, error: 'not configured' }),
};

export function configurePaymentsSync(next) {
  hooks = { ...hooks, ...next };
}

export async function ensurePaymentsAlarm() {
  await chrome.alarms.create(PAYMENTS_ALARM, {
    periodInMinutes: Math.max(1, Math.round(PAYMENTS_SYNC_INTERVAL_MS / 60000)),
  });
}

function formatSyncedLabel(atIso, count) {
  let hhmm = '—';
  try {
    const d = new Date(atIso || Date.now());
    hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    /* ignore */
  }
  return `Synced · ${hhmm} · ${count} invoice${count === 1 ? '' : 's'}`;
}

async function fetchFinancialsGet(tabId, url) {
  if (!tabId) return { ok: false, error: 'No Relay sync tab' };
  try {
    const res = await hooks.sendToTab(tabId, {
      type: 'RELAY_FETCH_FINANCIALS',
      url,
    });
    return res || { ok: false, error: 'Empty financials response' };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

async function postInvoices(invoices, summary, extensionApiKey) {
  const clientId = await ensureClientId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);
  try {
    const res = await fetch(RELAY_SYNC_FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Apikey: SUPABASE_ANON_KEY,
        'X-Relay-Extension-Key': extensionApiKey || '',
      },
      body: JSON.stringify({
        client_id: clientId,
        loads: [],
        payments: [],
        invoices,
        payments_summary: summary || null,
        observed_at: new Date().toISOString(),
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok || !json?.success) {
      const err =
        json?.error ||
        (typeof json?.message === 'string' ? json.message : null) ||
        text?.slice(0, 300) ||
        `HTTP ${res.status}`;
      throw new Error(err);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Merge settlement pages into pending invoice map, then flush.
 */
export async function ingestSettlementsPayload(data, { source = 'passive' } = {}) {
  const list = Array.isArray(data?.settlementList)
    ? data.settlementList
    : Array.isArray(data)
      ? data
      : [];
  const mapped = mapSettlementList(list).filter(
    (inv) => inv?.invoice_id && !String(inv.invoice_id).startsWith('FIXTURE-'),
  );
  if (!mapped.length) return { invoices: 0 };

  const state = await getState();
  const pending = { ...(state.pendingInvoices || {}) };
  for (const inv of mapped) {
    pending[inv.invoice_id] = inv;
  }
  await setState({
    pendingInvoices: pending,
    paymentsScanInProgress: false,
  });
  log(`${source}: queued ${mapped.length} invoice(s); pending=${Object.keys(pending).length}`);
  return { invoices: mapped.length, pageToken: data?.pageToken ?? null };
}

export async function ingestPaymentsSummary(data) {
  const summary = mapPaymentsSummary(data);
  if (!summary) return null;
  await setState({ pendingPaymentsSummary: summary });
  return summary;
}

/**
 * Passive capture handler for financials endpoints.
 */
export async function handleFinancialCapture(msg) {
  const state = await getState();
  const url = String(msg.url || '');
  const kind =
    msg.captureKind ||
    (url.includes('/settlements')
      ? 'settlements'
      : url.includes('/payments-summary')
        ? 'payments-summary'
        : null);
  if (!kind) return;

  const data = msg.data;
  const capturedAt = msg.capturedAt || new Date().toISOString();

  // Remember headers from Payments page for scheduled GETs
  if (msg.requestHeaders && Object.keys(msg.requestHeaders).length) {
    await setState({ financialHeaders: msg.requestHeaders });
  }

  if (!state.live || !state.loggedIn) {
    // Still mark section seen so popup isn't stuck on Not checked after browsing
    if (kind === 'settlements' && Array.isArray(data?.settlementList)) {
      await updateSection('payments', {
        state: 'Collecting',
        lastError: null,
        lastCollectedAt: capturedAt,
      });
    }
    return;
  }

  try {
    if (kind === 'settlements') {
      await updateSection('payments', {
        state: 'Collecting',
        lastError: null,
        lastCollectedAt: capturedAt,
      });
      await ingestSettlementsPayload(data, { source: 'passive' });
      // Paginate passively if pageToken present (scheduled path also paginates)
      const token = data?.pageToken;
      if (token) {
        await setState({ settlementsNextPageToken: token });
      }
      void flushPendingInvoices();
    } else if (kind === 'payments-summary') {
      await ingestPaymentsSummary(data);
      void flushPendingInvoices();
    }
  } catch (err) {
    const error = String(err?.message || err);
    log('handleFinancialCapture error', error);
    await updateSection('payments', { state: 'Error', lastError: error });
  }
}

export async function flushPendingInvoices() {
  const state = await getState();
  if (!state.live || !state.loggedIn || !state.extensionApiKey) return;
  const invoices = Object.values(state.pendingInvoices || {});
  const summary = state.pendingPaymentsSummary || null;
  if (!invoices.length && !summary) return;

  try {
    const json = await postInvoices(invoices, summary, state.extensionApiKey);
    const upserted = json.invoices_upserted ?? invoices.length;
    const at = new Date().toISOString();
    const label = formatSyncedLabel(at, upserted || invoices.length);
    await setState({
      pendingInvoices: {},
      pendingPaymentsSummary: null,
      lastPaymentsScanAt: at,
      lastPaymentsInvoiceCount: upserted || invoices.length,
      recordsCollected: (state.recordsCollected || 0) + (upserted || invoices.length),
      recordsUpdated: (state.recordsUpdated || 0) + (upserted || 0),
    });
    await updateSection('payments', {
      state: label,
      lastError: null,
      lastCollectedAt: at,
    });
    log('flushed invoices', label);
  } catch (err) {
    const error = String(err?.message || err);
    await updateSection('payments', { state: 'Error', lastError: error });
    log('flush invoices failed', error);
  }
}

/**
 * Full settlements pagination + summary. Low priority — caller gates timing.
 */
export async function syncPaymentsNow({ force = false } = {}) {
  if (syncRunning) return { ok: false, skipped: true, reason: 'already running' };
  const state = await getState();
  if (!state.live || !state.loggedIn) return { ok: false, error: 'not live' };

  const last = state.lastPaymentsScanAt ? Date.parse(state.lastPaymentsScanAt) : 0;
  if (!force && last && Date.now() - last < PAYMENTS_SYNC_INTERVAL_MS - 5000) {
    return { ok: true, skipped: true, reason: 'interval' };
  }

  syncRunning = true;
  await setState({ paymentsScanInProgress: true, paymentsScanStartedAt: new Date().toISOString() });
  await updateSection('payments', {
    state: 'Collecting',
    lastError: null,
  });

  try {
    const tabId = await hooks.getSyncTabId();
    if (!tabId) {
      throw new Error('Open a Relay tab (Payments or Trips) so financials can fetch');
    }

    // payments-summary first
    const sumRes = await fetchFinancialsGet(tabId, PAYMENTS_SUMMARY_URL);
    if (sumRes?.authRequired) {
      throw new Error(sumRes.error || 'Log in to Relay');
    }
    if (!sumRes?.ok) {
      throw new Error(sumRes?.error || 'payments-summary fetch failed');
    }
    await ingestPaymentsSummary(sumRes.data);

    // settlements pages
    let url = SETTLEMENTS_URL;
    let pages = 0;
    let totalMapped = 0;
    const maxPages = 50;
    while (pages < maxPages) {
      const res = await fetchFinancialsGet(tabId, url);
      if (res?.authRequired) {
        throw new Error(res.error || 'Log in to Relay');
      }
      if (!res?.ok) {
        throw new Error(res?.error || `settlements fetch failed (${res?.status || '?'})`);
      }
      const ingested = await ingestSettlementsPayload(res.data, { source: 'scheduled' });
      totalMapped += ingested.invoices || 0;
      pages += 1;
      const token = res.data?.pageToken;
      if (!token) break;
      url = `${SETTLEMENTS_URL}&pageToken=${encodeURIComponent(token)}`;
    }

    await flushPendingInvoices();
    const after = await getState();
    log(`payments sync done pages=${pages} mapped=${totalMapped}`);
    return {
      ok: true,
      pages,
      invoices: after.lastPaymentsInvoiceCount || totalMapped,
    };
  } catch (err) {
    const error = String(err?.message || err);
    await updateSection('payments', { state: 'Error', lastError: error });
    log('syncPaymentsNow error', error);
    return { ok: false, error };
  } finally {
    syncRunning = false;
    await setState({ paymentsScanInProgress: false });
  }
}

export function paymentsDue(state, now = Date.now()) {
  const last = state?.lastPaymentsScanAt ? Date.parse(state.lastPaymentsScanAt) : 0;
  if (!last) return true;
  return now - last >= PAYMENTS_SYNC_INTERVAL_MS;
}

/** Expose mapper for tests */
export { mapSettlementToInvoice, mapSettlementList, mapPaymentsSummary };
