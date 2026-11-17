import { SECTIONS } from '../shared/config.js';

const $ = (id) => document.getElementById(id);

function escapeAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

async function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function badgeClass(state) {
  return String(state || 'Not checked')
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function render(state) {
  const loggedIn = Boolean(state?.loggedIn);
  $('login-view').classList.toggle('hidden', loggedIn);
  $('main-view').classList.toggle('hidden', !loggedIn);
  if (!loggedIn) return;

  $('live-status').textContent = state.live ? 'LIVE' : 'Stopped';
  $('live-status').style.color = state.live ? '#7ddea8' : '#c9d4e3';
  $('last-sync').textContent = state.lastSyncAt
    ? new Date(state.lastSyncAt).toLocaleString()
    : '—';
  $('collected').textContent = String(state.recordsCollected || 0);
  $('updated').textContent = String(state.recordsUpdated || 0);
  $('inserted').textContent = String(state.recordsInserted || 0);
  $('errors').textContent = String((state.syncErrors || []).length);

  const prog = state.syncProgress || {};
  const phase = prog.phase || 'idle';
  const pct = Math.max(0, Math.min(100, Number(prog.percent) || 0));
  const busy =
    state.scanInProgress ||
    state.tripsScanInProgress ||
    state.paymentsScanInProgress ||
    state.reconnectSyncing ||
    state.catchUp?.active ||
    state.forceResync ||
    phase === 'syncing' ||
    phase === 'catch-up' ||
    phase === 'history-push' ||
    phase === 'force-resync' ||
    phase === 'history-backfill';
  const phaseLabel =
    phase === 'history-push'
      ? prog.detail || 'History push…'
      : state.forceResync || phase === 'force-resync'
        ? 'Force re-sync…'
        : state.reconnectSyncing || phase === 'syncing'
          ? 'Syncing with Relay…'
          : state.catchUp?.active || phase === 'catch-up'
            ? 'Catch-up…'
            : busy && phase !== 'near-live'
              ? `${phase}…`
              : phase;
  $('sync-phase').textContent = phaseLabel;
  $('sync-bar-fill').style.width = `${busy || pct ? pct : 0}%`;
  const durationNote =
    prog.lastDurationMs != null
      ? ` Last pass ${Math.round(prog.lastDurationMs / 1000)}s.`
      : '';
  const weeks = (prog.historyWeeks || []).length
    ? ` History weeks: ${prog.historyWeeks.join(', ')}.`
    : '';
  const health = state.health || {};
  $('sync-detail').textContent =
    (prog.detail ||
      'Live mirrors + catch-up. Badge = in-transit count (or ! if login needed).') +
    (health.status === 'auth' ? ' Log in to Relay.' : '') +
    durationNote +
    weeks;

  const tileSync = state.sectionSync || {};
  const counts = state.sectionCounts || {};
  const globalErr = state.lastFetchError;
  const tplMeta = state.templateMeta || {};
  const tplWrong = state.templateWrong || {};
  const histProg = state.historyBackfillProgress || {};
  $('tile-sync').innerHTML = ['IN_TRANSIT', 'UPCOMING', 'HISTORY']
    .map((tab) => {
      const s = tileSync[tab] || {};
      const c = counts[tab] || {};
      const meta = tplMeta[tab] || {};
      const when = s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleTimeString() : '—';
      const wrong =
        (tab === 'UPCOMING' && tplWrong.UPCOMING) ||
        (tab === 'IN_TRANSIT' && tplWrong.IN_TRANSIT);
      const fe =
        s.lastFetchError || (globalErr?.tab === tab ? globalErr : null);
      const errFull = wrong
        ? tplWrong.message || s.lastError || 'template wrong'
        : s.lastError || '';
      const err = errFull ? ` · ${errFull}` : '';
      const paused = s.paused ? ' · paused' : '';
      const title = fe
        ? [
            `URL: ${fe.url || '—'}`,
            `Context: ${fe.context || '—'}`,
            `HTTP: ${fe.status ?? '—'}`,
            `Message: ${fe.message || errFull || '—'}`,
            `At: ${fe.at || '—'}`,
          ].join('\n')
        : errFull;
      let relayN = c.relay ?? s.trips ?? 0;
      let crmN = c.crm ?? '—';
      let histExtra = '';
      if (tab === 'HISTORY') {
        // Cumulative across backfill weeks (not current window only)
        const cumRelay = Number(histProg.trips) || Number(relayN) || 0;
        const cumCrm = Number(histProg.crmTrips) || (crmN === '—' ? cumRelay : Number(crmN)) || 0;
        relayN = cumRelay;
        crmN = cumCrm;
        if (histProg.week && histProg.totalWeeks) {
          histExtra = ` · backfill week ${histProg.week}/${histProg.totalWeeks}`;
        } else if (histProg.label) {
          histExtra = ` · ${histProg.label}`;
        }
      }
      const mismatch = Boolean(c.mismatch) || (crmN !== '—' && Number(crmN) !== Number(relayN));
      const countCls = mismatch || wrong ? 'mismatch' : 'ok-count';
      const src = meta.label || (meta.source === 'fallback' ? 'fallback' : meta.source || '—');
      const badgeCls = s.lastError || wrong || s.paused ? 'error' : 'collecting';
      return `<li><span>${tab}</span><span class="badge ${badgeCls}" title="${escapeAttr(
        title,
      )}"><span class="${countCls}">Relay: ${relayN} | CRM: ${crmN}</span> · ${when} · ${src}${histExtra}${err}${paused}</span></li>`;
    })
    .join('');

  $('sections').innerHTML = SECTIONS.map((section) => {
    const st = state.sections?.[section.id]?.state || 'Not checked';
    const note =
      st === 'Synced'
        ? ' <span class="hint-inline" title="CRM upsert OK.">· OK</span>'
        : '';
    return `<li><span>${section.label}</span><span class="badge ${badgeClass(st)}">${st}</span>${note}</li>`;
  }).join('');

  const prompts = state.prompts || [];
  $('prompts').innerHTML = prompts.map((p) => `<div class="prompt">${p.message}</div>`).join('');

  const tabs = state.openTabs || [];
  $('tabs').innerHTML = tabs.length
    ? `<strong>Open Relay tabs</strong><div>${tabs
        .map((t) => `${t.title || 'Relay'} — ${t.url}`)
        .join('<br/>')}</div>`
    : '<strong>Open Relay tabs</strong><div>None detected</div>';

  const errs = (state.syncErrors || []).slice(-5).reverse();
  $('error-list').innerHTML = errs.length
    ? `<strong>Recent sync errors</strong>${errs
        .map((e) => `<div>${e.at}: ${e.error}</div>`)
        .join('')}`
    : '';
}

async function refresh() {
  const res = await send('GET_STATE');
  if (res?.ok) render(res.state);
}

$('login-btn').addEventListener('click', async () => {
  $('login-error').textContent = '';
  const res = await send('LOGIN', {
    username: $('username').value.trim(),
    password: $('password').value,
    extensionApiKey: $('api-key').value.trim(),
  });
  if (!res?.ok) {
    $('login-error').textContent = res?.error || 'Login failed';
    return;
  }
  render(res.state);
});

$('live-btn').addEventListener('click', async () => {
  const res = await send('GO_LIVE');
  if (!res?.ok) {
    alert(res?.error || 'Could not go live');
    return;
  }
  await refresh();
});

$('stop-btn').addEventListener('click', async () => {
  await send('STOP');
  await refresh();
});

$('scan-btn').addEventListener('click', async () => {
  await send('FORCE_SCAN');
  await refresh();
});

$('logout-btn').addEventListener('click', async () => {
  const res = await send('LOGOUT');
  if (res?.ok) render(res.state);
});

refresh();
setInterval(refresh, 2000);
