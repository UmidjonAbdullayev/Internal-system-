import { SECTIONS } from '../shared/config.js';

const $ = (id) => document.getElementById(id);

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

  $('sections').innerHTML = SECTIONS.map((section) => {
    const st = state.sections?.[section.id]?.state || 'Not checked';
    return `<li><span>${section.label}</span><span class="badge ${badgeClass(st)}">${st}</span></li>`;
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
