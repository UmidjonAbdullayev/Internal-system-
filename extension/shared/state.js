import { SCHEDULE_DEFAULTS } from './config.js';

const DEFAULT_SECTION_SYNC = {
  lastSyncAt: null,
  lastError: null,
  /** Structured last Relay fetch error for popup hover. */
  lastFetchError: null,
  /** Yellow "paused" after retries exhausted. */
  paused: false,
  pausedUntil: null,
  trips: 0,
  pages: 0,
  newCount: 0,
  changedCount: 0,
  removedCount: 0,
};

const DEFAULT_STATE = {
  loggedIn: false,
  live: false,
  lastSyncAt: null,
  recordsCollected: 0,
  recordsUpdated: 0,
  recordsInserted: 0,
  syncErrors: [],
  prompts: [],
  sections: {
    tours: { state: 'Not checked', lastError: null, lastCollectedAt: null },
    load_detail: { state: 'Not checked', lastError: null, lastCollectedAt: null },
    payments: { state: 'Not checked', lastError: null, lastCollectedAt: null },
  },
  openTabs: [],
  pendingLoads: {},
  pendingPayments: {},
  /** Mapped Relay invoices awaiting CRM flush (keyed by invoice_id). */
  pendingInvoices: {},
  pendingPaymentsSummary: null,
  financialHeaders: null,
  settlementsNextPageToken: null,
  lastPaymentsInvoiceCount: 0,
  /** Dedicated payments-sync fields (popup prefers these over DOM section state). */
  lastPaymentsAttemptAt: null,
  lastPaymentsError: null,
  collectionLocks: {},
  detailScraped: {},
  extensionApiKey: '',
  clientId: null,
  syncProgress: {
    phase: 'idle',
    detail: '',
    percent: 0,
    startedAt: null,
    lastDurationMs: null,
    typicalSeconds: 'always-on',
    historyWeeks: [],
  },
  lastPaymentsScanAt: null,
  lastTripsScanAt: null,
  scanInProgress: false,
  tripsScanInProgress: false,
  paymentsScanInProgress: false,
  tripsScanStartedAt: null,
  paymentsScanStartedAt: null,
  lastNearLiveAt: null,
  lastCaptureAt: null,
  lastCaptureUrl: null,
  lastCaptureTab: null,
  capturesSeen: 0,
  tripsExtracted: 0,
  /** @deprecated — HISTORY backfill is built into always-on */
  syncAllHistory: true,
  historyBackfillDone: false,
  syncedLoadCache: {},
  lastActiveLoadIds: [],
  /** Always-on health */
  health: {
    status: 'idle', // idle | healthy | auth | backoff
    message: '',
    inTransitCount: 0,
    pausedUntil: null,
    lastAuthErrorAt: null,
  },
  /** Per tileCountTab sync stats */
  sectionSync: {
    IN_TRANSIT: { ...DEFAULT_SECTION_SYNC },
    UPCOMING: { ...DEFAULT_SECTION_SYNC },
    HISTORY: { ...DEFAULT_SECTION_SYNC },
  },
  /** Schedule overrides (ms); enforced against SCHEDULE_MIN in options/SW */
  scheduleMs: { ...SCHEDULE_DEFAULTS },
  nextDueAt: {
    IN_TRANSIT: 0,
    UPCOMING: 0,
    HISTORY: 0,
  },
  hasRequestTemplate: false,
  alwaysOnTabId: null,
  /** Last page-context heartbeat from sync tab (ISO). */
  pageHeartbeatAt: null,
  /** Full last Relay fetch error (URL, context, status, message, at). */
  lastFetchError: null,
  /** Per-tab template source for popup verify */
  templateMeta: {
    IN_TRANSIT: { source: null, at: null, label: null },
    UPCOMING: { source: null, at: null, label: null },
    HISTORY: { source: null, at: null, label: null },
  },
  /** Set when UPCOMING∩IN_TRANSIT trip IDs overlap */
  templateWrong: {
    UPCOMING: false,
    IN_TRANSIT: false,
    message: null,
    overlapIds: [],
    at: null,
  },
  historyBackfillProgress: {
    week: 0,
    totalWeeks: 0,
    trips: 0,
    crmTrips: 0,
    label: null,
  },
  inTransitCaptureNavAt: null,
  /** Per section { relay, crm, mismatch } from snapshot response */
  sectionCounts: {
    IN_TRANSIT: { relay: 0, crm: 0, mismatch: false },
    UPCOMING: { relay: 0, crm: 0, mismatch: false },
    HISTORY: { relay: 0, crm: 0, mismatch: false },
  },
  /** After pause: Syncing… until first complete live snapshots + HISTORY catch-up */
  reconnectSyncing: false,
  pendingCatchUpMissing: [],
  /** When true, push all trips (ignore version/hash) until backfill completes. */
  forceResync: false,
  catchUp: {
    active: false,
    missingTripIds: [],
    foundTripIds: [],
    untilIso: null,
    startedAt: null,
  },
};

const DEFAULT_SECTION_ENTRY = { state: 'Not checked', lastError: null, lastCollectedAt: null };

export async function getState() {
  const stored = await chrome.storage.local.get(['relayState']);
  const merged = { ...DEFAULT_STATE, ...(stored.relayState || {}) };
  merged.sections = {
    tours: { ...DEFAULT_SECTION_ENTRY, ...(merged.sections?.tours || {}) },
    load_detail: { ...DEFAULT_SECTION_ENTRY, ...(merged.sections?.load_detail || {}) },
    payments: { ...DEFAULT_SECTION_ENTRY, ...(merged.sections?.payments || {}) },
  };
  merged.syncProgress = { ...DEFAULT_STATE.syncProgress, ...(merged.syncProgress || {}) };
  merged.health = { ...DEFAULT_STATE.health, ...(merged.health || {}) };
  merged.scheduleMs = { ...SCHEDULE_DEFAULTS, ...(merged.scheduleMs || {}) };
  merged.nextDueAt = { ...DEFAULT_STATE.nextDueAt, ...(merged.nextDueAt || {}) };
  merged.sectionSync = {
    IN_TRANSIT: { ...DEFAULT_SECTION_SYNC, ...(merged.sectionSync?.IN_TRANSIT || {}) },
    UPCOMING: { ...DEFAULT_SECTION_SYNC, ...(merged.sectionSync?.UPCOMING || {}) },
    HISTORY: { ...DEFAULT_SECTION_SYNC, ...(merged.sectionSync?.HISTORY || {}) },
  };
  merged.sectionCounts = {
    IN_TRANSIT: {
      relay: 0,
      crm: 0,
      mismatch: false,
      ...(merged.sectionCounts?.IN_TRANSIT || {}),
    },
    UPCOMING: {
      relay: 0,
      crm: 0,
      mismatch: false,
      ...(merged.sectionCounts?.UPCOMING || {}),
    },
    HISTORY: {
      relay: 0,
      crm: 0,
      mismatch: false,
      ...(merged.sectionCounts?.HISTORY || {}),
    },
  };
  merged.catchUp = {
    active: false,
    missingTripIds: [],
    foundTripIds: [],
    untilIso: null,
    startedAt: null,
    ...(merged.catchUp || {}),
  };
  merged.templateMeta = {
    IN_TRANSIT: {
      source: null,
      at: null,
      label: null,
      ...(merged.templateMeta?.IN_TRANSIT || {}),
    },
    UPCOMING: {
      source: null,
      at: null,
      label: null,
      ...(merged.templateMeta?.UPCOMING || {}),
    },
    HISTORY: {
      source: null,
      at: null,
      label: null,
      ...(merged.templateMeta?.HISTORY || {}),
    },
  };
  merged.templateWrong = {
    UPCOMING: false,
    IN_TRANSIT: false,
    message: null,
    overlapIds: [],
    at: null,
    ...(merged.templateWrong || {}),
  };
  merged.historyBackfillProgress = {
    week: 0,
    totalWeeks: 0,
    trips: 0,
    label: null,
    ...(merged.historyBackfillProgress || {}),
  };
  return merged;
}

/** Serialize read-modify-write so concurrent always-on + payments setState cannot clobber. */
let stateWriteChain = Promise.resolve();

async function setStateUnlocked(patch) {
  const current = await getState().catch(() => ({ ...DEFAULT_STATE }));
  const next = { ...current, ...patch };
  if (patch.sections) {
    const base = current.sections || DEFAULT_STATE.sections;
    next.sections = { ...base };
    for (const [id, secPatch] of Object.entries(patch.sections)) {
      next.sections[id] = { ...(base[id] || DEFAULT_SECTION_ENTRY), ...secPatch };
    }
  }
  if (patch.syncProgress) {
    next.syncProgress = { ...(current.syncProgress || {}), ...patch.syncProgress };
  }
  if (patch.health) {
    next.health = { ...(current.health || {}), ...patch.health };
  }
  if (patch.scheduleMs) {
    next.scheduleMs = { ...(current.scheduleMs || {}), ...patch.scheduleMs };
  }
  if (patch.nextDueAt) {
    next.nextDueAt = { ...(current.nextDueAt || {}), ...patch.nextDueAt };
  }
  if (patch.sectionSync) {
    next.sectionSync = {
      IN_TRANSIT: { ...(current.sectionSync?.IN_TRANSIT || {}), ...(patch.sectionSync.IN_TRANSIT || {}) },
      UPCOMING: { ...(current.sectionSync?.UPCOMING || {}), ...(patch.sectionSync.UPCOMING || {}) },
      HISTORY: { ...(current.sectionSync?.HISTORY || {}), ...(patch.sectionSync.HISTORY || {}) },
    };
  }
  if (patch.catchUp) {
    next.catchUp = { ...(current.catchUp || {}), ...patch.catchUp };
  }
  if (patch.sectionCounts) {
    next.sectionCounts = {
      IN_TRANSIT: { ...(current.sectionCounts?.IN_TRANSIT || {}), ...(patch.sectionCounts.IN_TRANSIT || {}) },
      UPCOMING: { ...(current.sectionCounts?.UPCOMING || {}), ...(patch.sectionCounts.UPCOMING || {}) },
      HISTORY: { ...(current.sectionCounts?.HISTORY || {}), ...(patch.sectionCounts.HISTORY || {}) },
    };
  }
  if (patch.templateMeta) {
    next.templateMeta = {
      IN_TRANSIT: { ...(current.templateMeta?.IN_TRANSIT || {}), ...(patch.templateMeta.IN_TRANSIT || {}) },
      UPCOMING: { ...(current.templateMeta?.UPCOMING || {}), ...(patch.templateMeta.UPCOMING || {}) },
      HISTORY: { ...(current.templateMeta?.HISTORY || {}), ...(patch.templateMeta.HISTORY || {}) },
    };
  }
  if (patch.templateWrong) {
    next.templateWrong = { ...(current.templateWrong || {}), ...patch.templateWrong };
  }
  if (patch.historyBackfillProgress) {
    next.historyBackfillProgress = {
      ...(current.historyBackfillProgress || {}),
      ...patch.historyBackfillProgress,
    };
  }
  try {
    await chrome.storage.local.set({ relayState: next });
  } catch (err) {
    console.warn('[setState] storage error (sync continues)', err);
  }
  return next;
}

export function setState(patch) {
  const run = stateWriteChain.then(() => setStateUnlocked(patch));
  // Keep the chain alive even if a write fails
  stateWriteChain = run.catch((err) => {
    console.warn('[setState] queued write failed', err);
  });
  return run;
}


export async function updateSection(sectionId, patch) {
  return setState({
    sections: {
      [sectionId]: patch,
    },
  });
}

export async function ensureClientId() {
  const state = await getState();
  if (state.clientId) return state.clientId;
  const id = crypto.randomUUID();
  await setState({ clientId: id });
  return id;
}

export function sectionStateLabel(state) {
  return state || 'Not checked';
}
