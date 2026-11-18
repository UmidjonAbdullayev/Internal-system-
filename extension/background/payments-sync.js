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
import { getState, setState, ensureClientId } from '../shared/state.js';
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

export function formatSyncedLabel(atIso, count) {
  let hhmm = '—';
  try {
    const d = new Date(atIso || Date.now());
    hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    /* ignore */
  }
  const n = Number(count) || 0;
  return `Synced · ${hhmm} · ${n} invoice${n === 1 ? '' : 's'}`;
}

/** Popup + section label after a fetch attempt — never leave "Not checked". */
async function markPaymentsAttempt(patch = {}) {
  const at = patch.lastPaymentsAttemptAt || new Date().toISOString();
  const next = {
    lastPaymentsAttemptAt: at,
    lastPaymentsError: patch.lastError !== undefined ? patch.lastError : null,
    sections: {
      payments: {
        state: patch.state || 'Collecting',
        lastError: patch.lastError !== undefined ? patch.lastError : null,
        lastCollectedAt: patch.lastCollectedAt || at,
      },
    },
  };
  for (const key of [
    'paymentsScanInProgress',
    'paymentsScanStartedAt',
    'lastPaymentsScanAt',
    'lastPaymentsInvoiceCount',
    'pendingInvoices',
    'pendingPaymentsSummary',
    'recordsCollected',
    'recordsUpdated',
    'financialHeaders',
    'settlementsNextPageToken',
  ]) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  return setState(next);
}

async function markPaymentsError(error) {
  const msg = String(error || 'payments sync failed');
  log('payments error', msg);
  return markPaymentsAttempt({
    state: 'Error',
    lastError: msg,
    paymentsScanInProgress: false,
  });
}

async function markPaymentsSynced(atIso, count) {
  const at = atIso || new Date().toISOString();
  const label = formatSyncedLabel(at, count);
  return markPaymentsAttempt({
    state: label,
    lastError: null,
    lastCollectedAt: at,
    lastPaymentsScanAt: at,
    lastPaymentsInvoiceCount: Number(count) || 0,
    paymentsScanInProgress: false,
  });
}

async function fetchFinancialsGet(tabId, url, headers) {
  if (!tabId) return { ok: false, error: 'No Relay sync tab' };
  try {
    const res = await hooks.sendToTab(tabId, {
      type: 'RELAY_FETCH_FINANCIALS',
      url,
      headers: headers || null,
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
    log(
      'relay-sync invoices response',
      `http=${res.status} upserted=${json.invoices_upserted ?? '?'} trips=${json.invoice_trips_upserted ?? '?'}`,
    );
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
  if (!mapped.length) {
    log(`${source}: 0 invoices mapped from ${list.length} settlement row(s)`);
    return { invoices: 0, raw: list.length };
  }

  const state = await getState();
  const pending = { ...(state.pendingInvoices || {}) };
  for (const inv of mapped) {
    pending[inv.invoice_id] = inv;
  }
  await setState({
    pendingInvoices: pending,
  });
  log(`${source}: queued ${mapped.length} invoice(s); pending=${Object.keys(pending).length}`);
  return { invoices: mapped.length, pageToken: data?.pageToken ?? null, raw: list.length };
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
  log('capture', kind, url.slice(0, 120));

  const headerPatch =
    msg.requestHeaders && Object.keys(msg.requestHeaders).length
      ? { financialHeaders: msg.requestHeaders }
      : {};

  if (!state.live || !state.loggedIn) {
    // Mark attempt so popup leaves "Not checked" after browsing Payments
    await markPaymentsAttempt({
      state: 'Collecting',
      lastError: null,
      lastCollectedAt: capturedAt,
      lastPaymentsAttemptAt: capturedAt,
      ...headerPatch,
    });
    return;
  }

  try {
    if (Object.keys(headerPatch).length) {
      await setState(headerPatch);
    }
    await markPaymentsAttempt({
      state: 'Collecting',
      lastError: null,
      lastCollectedAt: capturedAt,
      lastPaymentsAttemptAt: capturedAt,
    });
    if (kind === 'settlements') {
      await ingestSettlementsPayload(data, { source: 'passive' });
      const token = data?.pageToken;
      if (token) {
        await setState({ settlementsNextPageToken: token });
      }
      await flushPendingInvoices({ allowEmpty: false });
    } else if (kind === 'payments-summary') {
      await ingestPaymentsSummary(data);
      await flushPendingInvoices({ allowEmpty: false });
    }
  } catch (err) {
    await markPaymentsError(err?.message || err);
  }
}

export async function flushPendingInvoices({ allowEmpty = false } = {}) {
  const state = await getState();
  if (!state.live || !state.loggedIn || !state.extensionApiKey) {
    if (allowEmpty) {
      await markPaymentsError('Not live or missing extension API key');
    }
    return null;
  }
  const invoices = Object.values(state.pendingInvoices || {});
  const summary = state.pendingPaymentsSummary || null;
  if (!invoices.length && !summary) {
    if (allowEmpty) {
      // Successful settlements fetch that mapped nothing — still terminal Synced
      await markPaymentsSynced(new Date().toISOString(), state.lastPaymentsInvoiceCount || 0);
    }
    return null;
  }

  try {
    const json = await postInvoices(invoices, summary, state.extensionApiKey);
    // Deployed edge must return invoices_upserted. Missing/0 with a non-empty
    // payload means the function ignored invoices (false Synced) — surface Error.
    const upsertedRaw = json.invoices_upserted;
    if (invoices.length > 0) {
      if (typeof upsertedRaw !== 'number') {
        throw new Error(
          'relay-sync missing invoices_upserted — edge function likely outdated (no invoice upsert)',
        );
      }
      if (upsertedRaw <= 0) {
        const detail = Array.isArray(json.errors) && json.errors.length
          ? json.errors.slice(0, 3).join('; ')
          : 'invoices_upserted=0';
        throw new Error(`Invoice upsert failed: ${detail}`);
      }
    }
    const upserted = Number(upsertedRaw) || 0;
    const at = new Date().toISOString();
    const count = invoices.length ? upserted : state.lastPaymentsInvoiceCount || 0;
    const prev = await getState();
    await setState({
      pendingInvoices: {},
      pendingPaymentsSummary: null,
      lastPaymentsScanAt: at,
      lastPaymentsInvoiceCount: count,
      lastPaymentsAttemptAt: at,
      lastPaymentsError: null,
      recordsCollected: (prev.recordsCollected || 0) + (invoices.length || (summary ? 1 : 0)),
      recordsUpdated: (prev.recordsUpdated || 0) + upserted,
      paymentsScanInProgress: false,
      sections: {
        payments: {
          state: formatSyncedLabel(at, count),
          lastError: null,
          lastCollectedAt: at,
        },
      },
    });
    log('flushed invoices', formatSyncedLabel(at, count));
    return json;
  } catch (err) {
    await markPaymentsError(err?.message || err);
    return null;
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
  const startedAt = new Date().toISOString();
  await markPaymentsAttempt({
    state: 'Collecting',
    lastError: null,
    lastPaymentsAttemptAt: startedAt,
    paymentsScanInProgress: true,
    paymentsScanStartedAt: startedAt,
  });

  try {
    const tabId = await hooks.getSyncTabId();
    if (!tabId) {
      throw new Error('Open a Relay tab (Payments or Trips) so financials can fetch');
    }

    const headers = (await getState()).financialHeaders || null;

    // payments-summary first
    const sumRes = await fetchFinancialsGet(tabId, PAYMENTS_SUMMARY_URL, headers);
    log('payments-summary fetch', {
      ok: sumRes?.ok,
      status: sumRes?.status,
      authRequired: sumRes?.authRequired,
      error: sumRes?.error,
    });
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
    let totalRaw = 0;
    const maxPages = 50;
    while (pages < maxPages) {
      const res = await fetchFinancialsGet(tabId, url, headers);
      log('settlements fetch', {
        page: pages + 1,
        ok: res?.ok,
        status: res?.status,
        authRequired: res?.authRequired,
        error: res?.error,
        url: url.slice(0, 120),
      });
      if (res?.authRequired) {
        throw new Error(res.error || 'Log in to Relay');
      }
      if (!res?.ok) {
        throw new Error(res?.error || `settlements fetch failed (${res?.status || '?'})`);
      }
      const ingested = await ingestSettlementsPayload(res.data, { source: 'scheduled' });
      totalMapped += ingested.invoices || 0;
      totalRaw += ingested.raw || 0;
      pages += 1;
      const token = res.data?.pageToken;
      if (!token) break;
      url = `${SETTLEMENTS_URL}&pageToken=${encodeURIComponent(token)}`;
    }

    await flushPendingInvoices({ allowEmpty: true });
    const after = await getState();
    // If flush left an error, surface it
    if (after.lastPaymentsError) {
      return { ok: false, error: after.lastPaymentsError, pages, invoices: totalMapped };
    }
    // Guarantee terminal Synced label even if flush was a no-op race
    if (!after.lastPaymentsScanAt || !/^Synced/i.test(String(after.sections?.payments?.state || ''))) {
      await markPaymentsSynced(new Date().toISOString(), totalMapped);
    }
    log(`payments sync done pages=${pages} raw=${totalRaw} mapped=${totalMapped}`);
    return {
      ok: true,
      pages,
      invoices: (await getState()).lastPaymentsInvoiceCount || totalMapped,
    };
  } catch (err) {
    const error = String(err?.message || err);
    await markPaymentsError(error);
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
