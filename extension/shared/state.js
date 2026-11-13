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
  extensionApiKey: '',
  clientId: null,
};

export async function getState() {
  const stored = await chrome.storage.local.get(['relayState']);
  return { ...DEFAULT_STATE, ...(stored.relayState || {}) };
}

export async function setState(patch) {
  const current = await getState();
  const next = { ...current, ...patch };
  if (patch.sections) {
    next.sections = { ...current.sections, ...patch.sections };
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
