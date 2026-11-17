/**
 * MAIN-world hooks for Amazon Relay JSON capture.
 * Never touches the DOM. Always returns original network responses.
 * Failures are swallowed so Relay never breaks.
 */
(() => {
  try {
    if (window.__RELAY_API_CAPTURE_INSTALLED__) return;
    window.__RELAY_API_CAPTURE_INSTALLED__ = true;

    const CAPTURE_TYPE = '__RELAY_CAPTURE__';
    const DEBUG = true;

    function safePost(url, data) {
      try {
        window.postMessage({ type: CAPTURE_TYPE, url: String(url || ''), data }, location.origin);
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.log('[RelayCapture MAIN] captured JSON', String(url || '').slice(0, 180));
        }
      } catch {
        /* ignore */
      }
    }

    function looksJsonContentType(headersLike) {
      try {
        if (!headersLike) return false;
        let ct = '';
        if (typeof headersLike.get === 'function') {
          ct = headersLike.get('content-type') || headersLike.get('Content-Type') || '';
        } else if (typeof headersLike === 'string') {
          ct = headersLike;
        }
        return /json/i.test(String(ct));
      } catch {
        return false;
      }
    }

    function maybeCaptureBody(url, bodyText, contentType) {
      try {
        if (!looksJsonContentType(contentType) && bodyText) {
          const trimmed = String(bodyText).trim();
          if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return;
        } else if (!looksJsonContentType(contentType)) {
          return;
        }
        const data = JSON.parse(bodyText);
        safePost(url, data);
      } catch {
        /* ignore parse / post failures */
      }
    }

    // --- fetch ---
    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = async function relayCaptureFetch(input, init) {
        const res = await originalFetch.apply(this, arguments);
        try {
          const url =
            typeof input === 'string'
              ? input
              : input && typeof input.url === 'string'
                ? input.url
                : String(input);
          const ct = res.headers?.get?.('content-type') || '';
          if (looksJsonContentType(ct) || /json/i.test(ct)) {
            res
              .clone()
              .json()
              .then((data) => safePost(url, data))
              .catch(() => {
                /* ignore */
              });
          }
        } catch {
          /* ignore */
        }
        return res;
      };
    }

    // --- XMLHttpRequest ---
    const XHR = window.XMLHttpRequest;
    if (typeof XHR === 'function') {
      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;

      XHR.prototype.open = function relayCaptureOpen(method, url) {
        try {
          this.__relayCaptureUrl = String(url || '');
        } catch {
          /* ignore */
        }
        return originalOpen.apply(this, arguments);
      };

      XHR.prototype.send = function relayCaptureSend(body) {
        try {
          this.addEventListener(
            'load',
            function onLoad() {
              try {
                const url = this.__relayCaptureUrl || '';
                const ct =
                  (typeof this.getResponseHeader === 'function' &&
                    (this.getResponseHeader('content-type') ||
                      this.getResponseHeader('Content-Type'))) ||
                  '';
                const text =
                  typeof this.responseText === 'string'
                    ? this.responseText
                    : typeof this.response === 'string'
                      ? this.response
                      : '';
                if (text) maybeCaptureBody(url, text, ct);
              } catch {
                /* ignore */
              }
            },
            { once: true },
          );
        } catch {
          /* ignore */
        }
        return originalSend.apply(this, arguments);
      };
    }

    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.log('[RelayCapture MAIN] fetch/XHR hooks installed');
    }
  } catch {
    /* never break the page */
  }
})();
