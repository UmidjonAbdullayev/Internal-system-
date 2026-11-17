/**
 * Isolated-world bridge: MAIN postMessage ↔ background.
 * No DOM scraping.
 */
(() => {
  try {
    if (window.__RELAY_CAPTURE_BRIDGE__) return;
    window.__RELAY_CAPTURE_BRIDGE__ = true;

    const CAPTURE_TYPE = '__RELAY_CAPTURE__';
    const FETCH_REQ = '__RELAY_FETCH_ENTITIES_V2_REQ__';
    const FETCH_RES = '__RELAY_FETCH_ENTITIES_V2_RES__';
    const DEBUG = true;

    const pendingFetches = new Map();

    window.addEventListener(
      'message',
      (e) => {
        try {
          if (e.source !== window) return;
          const msg = e.data;
          if (!msg || typeof msg !== 'object') return;

          if (msg.type === CAPTURE_TYPE) {
            chrome.runtime.sendMessage(
              {
                type: 'RELAY_CAPTURE',
                url: typeof msg.url === 'string' ? msg.url : '',
                requestBody: msg.requestBody || null,
                requestHeaders: msg.requestHeaders || null,
                data: msg.data,
                capturedAt: new Date().toISOString(),
                pageUrl: location.href,
              },
              () => {
                void chrome.runtime.lastError;
              },
            );
            if (DEBUG) {
              const tab = msg.requestBody?.tileCountTab || '?';
              // eslint-disable-next-line no-console
              console.log('[RelayCapture bridge] forwarded entitiesV2', tab);
            }
            return;
          }

          if (msg.type === FETCH_RES && msg.requestId) {
            const pending = pendingFetches.get(msg.requestId);
            if (pending) {
              pendingFetches.delete(msg.requestId);
              pending(msg);
            }
          }
        } catch {
          /* ignore */
        }
      },
      false,
    );

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== 'RELAY_FETCH_ENTITIES_V2') return;
      (async () => {
        try {
          const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          const result = await new Promise((resolve) => {
            const timer = setTimeout(() => {
              pendingFetches.delete(requestId);
              resolve({
                ok: false,
                context: 'content',
                url: msg.url || '',
                error: 'entitiesV2 fetch timed out',
                at: new Date().toISOString(),
              });
            }, 45000);
            pendingFetches.set(requestId, (res) => {
              clearTimeout(timer);
              resolve(res);
            });
            window.postMessage(
              {
                type: FETCH_REQ,
                requestId,
                url: msg.url,
                body: msg.body,
                headers: msg.headers || null,
              },
              location.origin,
            );
          });
          sendResponse(result);
        } catch (err) {
          sendResponse({
            ok: false,
            context: 'content',
            url: msg.url || '',
            error: String(err?.message || err),
            at: new Date().toISOString(),
          });
        }
      })();
      return true;
    });

    // Page heartbeat every 30s so SW can reload stale sync tabs.
    const beat = () => {
      try {
        chrome.runtime.sendMessage({ type: 'RELAY_PAGE_HEARTBEAT', pageUrl: location.href }, () => {
          void chrome.runtime.lastError;
        });
      } catch {
        /* ignore */
      }
    };
    beat();
    setInterval(beat, 30000);

    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.log('[RelayCapture bridge] listening for entitiesV2 captures');
    }
  } catch {
    /* never break the page */
  }
})();
