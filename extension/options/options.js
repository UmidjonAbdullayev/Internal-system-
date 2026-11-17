import { RAW_CAPTURES_KEY, MAX_RAW_CAPTURES, SCHEDULE_MIN } from '../shared/config.js';

const statsEl = document.getElementById('capture-stats');
const statusEl = document.getElementById('download-status');
const scheduleStatus = document.getElementById('schedule-status');
const templateStatus = document.getElementById('template-status');
const btn = document.getElementById('download-captures');
const saveBtn = document.getElementById('save-schedule');
const inTransitEl = document.getElementById('sched-in-transit');
const upcomingEl = document.getElementById('sched-upcoming');
const historyEl = document.getElementById('sched-history');

async function loadStats() {
  const stored = await chrome.storage.local.get([RAW_CAPTURES_KEY, 'relayState', 'relayRequestTemplate']);
  const captures = stored[RAW_CAPTURES_KEY] || [];
  const state = stored.relayState || {};
  const sched = state.scheduleMs || {};
  inTransitEl.value = Math.round((sched.IN_TRANSIT_MS || SCHEDULE_MIN.IN_TRANSIT_MS) / 1000);
  upcomingEl.value = Math.round((sched.UPCOMING_MS || SCHEDULE_MIN.UPCOMING_MS) / 1000);
  historyEl.value = Math.round((sched.HISTORY_PAGE1_MS || SCHEDULE_MIN.HISTORY_PAGE1_MS) / 60000);
  statsEl.textContent = [
    `Stored: ${captures.length} / ${MAX_RAW_CAPTURES}`,
    `Captures seen: ${state.capturesSeen ?? 0}`,
    `Trips extracted: ${state.tripsExtracted ?? 0}`,
    `Health: ${state.health?.status || '—'} ${state.health?.message || ''}`,
    `Last tab: ${state.lastCaptureTab || '—'}`,
  ].join('\n');
  templateStatus.textContent = stored.relayRequestTemplate?.body
    ? `Request template: seeded (${stored.relayRequestTemplate.at || '—'})`
    : 'Request template: not seeded yet (open Relay / GO LIVE)';
}

btn.addEventListener('click', async () => {
  statusEl.textContent = 'Preparing download…';
  try {
    const stored = await chrome.storage.local.get([RAW_CAPTURES_KEY]);
    const captures = stored[RAW_CAPTURES_KEY] || [];
    const blob = new Blob([JSON.stringify(captures, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relay-entitiesV2-captures-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    statusEl.textContent = `Downloaded ${captures.length} capture(s).`;
  } catch (err) {
    statusEl.textContent = `Download failed: ${err?.message || err}`;
  }
});

saveBtn.addEventListener('click', async () => {
  const scheduleMs = {
    IN_TRANSIT_MS: Math.max(SCHEDULE_MIN.IN_TRANSIT_MS, Number(inTransitEl.value) * 1000),
    UPCOMING_MS: Math.max(SCHEDULE_MIN.UPCOMING_MS, Number(upcomingEl.value) * 1000),
    HISTORY_PAGE1_MS: Math.max(SCHEDULE_MIN.HISTORY_PAGE1_MS, Number(historyEl.value) * 60000),
  };
  inTransitEl.value = Math.round(scheduleMs.IN_TRANSIT_MS / 1000);
  upcomingEl.value = Math.round(scheduleMs.UPCOMING_MS / 1000);
  historyEl.value = Math.round(scheduleMs.HISTORY_PAGE1_MS / 60000);
  const res = await chrome.runtime.sendMessage({ type: 'SET_SCHEDULE', scheduleMs });
  scheduleStatus.textContent = res?.ok ? 'Schedule saved (mins enforced).' : `Failed: ${res?.error || 'unknown'}`;
});

loadStats();
setInterval(loadStats, 3000);
