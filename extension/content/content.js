/**
 * Isolated-world bridge: MAIN postMessage → background.
 * No DOM scraping, no clicks, no MutationObserver on the table.
 */
(() => {
  try {
    if (window.__RELAY_CAPTURE_BRIDGE__) return;
    window.__RELAY_CAPTURE_BRIDGE__ = true;

    const CAPTURE_TYPE = '__RELAY_CAPTURE__';
    const DEBUG = true;

    window.addEventListener(
      'message',
      (e) => {
        try {
          if (e.source !== window) return;
          const msg = e.data;
          if (!msg || msg.type !== CAPTURE_TYPE) return;
          if (typeof msg.url !== 'string') return;
          chrome.runtime
            .sendMessage({
              type: 'RELAY_CAPTURE',
              url: msg.url,
              data: msg.data,
              capturedAt: new Date().toISOString(),
              pageUrl: location.href,
            })
            .catch(() => {
              /* SW may be restarting */
            });
          if (DEBUG) {
            // eslint-disable-next-line no-console
            console.log('[RelayCapture bridge] forwarded', msg.url.slice(0, 160));
          }
        } catch {
          /* ignore */
        }
      },
      false,
    );

    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.log('[RelayCapture bridge] listening for MAIN captures');
    }
  } catch {
    /* never break the page */
  }
})();
