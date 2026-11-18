#!/usr/bin/env node
/**
 * Startup smoke: build preview + load /loads once.
 * Fails if React boot crashes (blank #root) or page errors fire.
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = Number(process.env.SMOKE_PORT || 4173);
const BASE = `http://127.0.0.1:${PORT}`;
const PATH = process.env.SMOKE_PATH || '/loads?tab=in_transit';

function startPreview() {
  const child = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BROWSER: 'none' },
    },
  );
  let ready = false;
  const onData = (buf) => {
    const text = buf.toString();
    if (text.includes('Local:') || text.includes(String(PORT))) ready = true;
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  return {
    child,
    async waitReady(ms = 30_000) {
      const start = Date.now();
      while (!ready && Date.now() - start < ms) {
        if (child.exitCode != null) {
          throw new Error(`vite preview exited early (${child.exitCode})`);
        }
        await delay(150);
      }
      if (!ready) throw new Error('vite preview did not become ready');
    },
    stop() {
      if (child.exitCode != null) return;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      // Ensure CI does not hang if vite ignores SIGTERM.
      setTimeout(() => {
        if (child.exitCode == null) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
      }, 2000).unref?.();
    },
  };
}

async function main() {
  const preview = startPreview();
  let browser;
  try {
    await preview.waitReady();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));

    const res = await page.goto(`${BASE}${PATH}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    if (!res || !res.ok()) {
      throw new Error(`HTTP ${res?.status()} loading ${PATH}`);
    }

    // Give React a beat to mount (or crash into ErrorBoundary / blank root).
    await delay(1500);

    const snapshot = await page.evaluate(() => {
      const root = document.getElementById('root');
      const text = (root?.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        hasRoot: Boolean(root),
        childCount: root?.childElementCount ?? 0,
        textSample: text.slice(0, 240),
        showsErrorUi: /Something went wrong/i.test(text),
      };
    });

    if (pageErrors.length) {
      throw new Error(`Page JS errors:\n${pageErrors.join('\n')}`);
    }
    if (!snapshot.hasRoot || snapshot.childCount === 0) {
      throw new Error('Blank #root — React did not mount');
    }
    if (snapshot.showsErrorUi) {
      throw new Error(`ErrorBoundary rendered: ${snapshot.textSample}`);
    }
    // App chrome should paint even while data hydrates.
    if (!/Loads|Trips|Drivers|Overview|Gross|Reports|Payments/i.test(snapshot.textSample)) {
      throw new Error(`Unexpected empty shell text: ${snapshot.textSample || '(empty)'}`);
    }

    console.log(`smoke ok: ${PATH} → "${snapshot.textSample.slice(0, 80)}…"`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    preview.stop();
  }
}

main().catch((err) => {
  console.error('smoke failed:', err.message || err);
  process.exit(1);
});
