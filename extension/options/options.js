import { RAW_CAPTURES_KEY, MAX_RAW_CAPTURES } from '../shared/config.js';

const statsEl = document.getElementById('capture-stats');
const statusEl = document.getElementById('download-status');
const btn = document.getElementById('download-captures');

async function loadStats() {
  const stored = await chrome.storage.local.get([RAW_CAPTURES_KEY, 'relayState']);
  const captures = stored[RAW_CAPTURES_KEY] || [];
  const state = stored.relayState || {};
  statsEl.textContent = [
    `Stored: ${captures.length} / ${MAX_RAW_CAPTURES}`,
    `Captures seen (session counters): ${state.capturesSeen ?? 0}`,
    `Trips extracted: ${state.tripsExtracted ?? 0}`,
    `Last capture: ${state.lastCaptureAt || '—'}`,
    `Last URL: ${state.lastCaptureUrl || '—'}`,
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
    a.download = `relay-raw-captures-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    statusEl.textContent = `Downloaded ${captures.length} capture(s).`;
  } catch (err) {
    statusEl.textContent = `Download failed: ${err?.message || err}`;
  }
});

loadStats();
setInterval(loadStats, 3000);
