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
    typicalSeconds: 'passive',
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
  /** Optional: replay entitiesV2 with HISTORY pagination. Default OFF. */
  syncAllHistory: false,
  syncedLoadCache: {},
  lastActiveLoadIds: [],
};

export async function getState() {
  const stored = await chrome.storage.local.get(['relayState']);
  const merged = { ...DEFAULT_STATE, ...(stored.relayState || {}) };
  merged.syncProgress = { ...DEFAULT_STATE.syncProgress, ...(merged.syncProgress || {}) };
  return merged;
}

export async function setState(patch) {
  const current = await getState();
  const next = { ...current, ...patch };
  if (patch.sections) {
    next.sections = { ...current.sections, ...patch.sections };
  }
  if (patch.syncProgress) {
    next.syncProgress = { ...current.syncProgress, ...patch.syncProgress };
  }
  await chrome.storage.local.set({ relayState: next });
  return next;
}

export async function updateSection(sectionId, patch) {
  const current = await getState();
  const sections = {
    ...current.sections,
    [sectionId]: { ...current.sections[sectionId], ...patch },
  };
  return setState({ sections });
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
