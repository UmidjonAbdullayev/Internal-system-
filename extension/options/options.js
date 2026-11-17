import { RAW_CAPTURES_KEY, MAX_RAW_CAPTURES } from '../shared/config.js';

const statsEl = document.getElementById('capture-stats');
const statusEl = document.getElementById('download-status');
const historyStatus = document.getElementById('history-status');
const btn = document.getElementById('download-captures');
const historyCb = document.getElementById('sync-all-history');

async function loadStats() {
  const stored = await chrome.storage.local.get([RAW_CAPTURES_KEY, 'relayState']);
  const captures = stored[RAW_CAPTURES_KEY] || [];
  const state = stored.relayState || {};
  historyCb.checked = Boolean(state.syncAllHistory);
  statsEl.textContent = [
    `Stored: ${captures.length} / ${MAX_RAW_CAPTURES}`,
    `Captures seen: ${state.capturesSeen ?? 0}`,
    `Trips extracted: ${state.tripsExtracted ?? 0}`,
    `Last tab: ${state.lastCaptureTab || '—'}`,
    `Last capture: ${state.lastCaptureAt || '—'}`,
  ].join('\n');
}

btn.addEventListener('click', async () => {
  statusEl.textContent = 'Preparing download…';
  try {
    const stored = await chrome.storage.local.get([RAW_CAPTURES_KEY]);
    const captures = stored[RAW_CAPTURES_KEY] || [];
    const blob = new Blob([JSON.stringify(captures, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `relay-entitiesV2-captures-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    statusEl.textContent = `Downloaded ${captures.length} capture(s).`;
  } catch (err) {
    statusEl.textContent = `Download failed: ${err?.message || err}`;
  }
});

historyCb.addEventListener('change', async () => {
  historyStatus.textContent = 'Saving…';
  const res = await chrome.runtime.sendMessage({
    type: 'SET_SYNC_ALL_HISTORY',
    syncAllHistory: historyCb.checked,
  });
  historyStatus.textContent = res?.ok
    ? historyCb.checked
      ? 'History pagination enabled (runs while LIVE after a Trips capture).'
      : 'History pagination disabled.'
    : `Failed: ${res?.error || 'unknown'}`;
});

loadStats();
setInterval(loadStats, 3000);
