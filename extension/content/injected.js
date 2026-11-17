/**
 * MAIN-world hooks — capture ONLY POST /api/tours/entitiesV2.
 * Never touches the DOM. Never consumes/alters original responses.
 */
(() => {
  try {
    if (window.__RELAY_API_CAPTURE_INSTALLED__) return;
    window.__RELAY_API_CAPTURE_INSTALLED__ = true;

    const CAPTURE_TYPE = '__RELAY_CAPTURE__';
    const FETCH_REQ = '__RELAY_FETCH_ENTITIES_V2_REQ__';
    const FETCH_RES = '__RELAY_FETCH_ENTITIES_V2_RES__';
    const TARGET = '/api/tours/entitiesV2';
    const DEBUG = true;

    /** Last successful entitiesV2 request headers (for optional History replay). */
    let lastHeaders = null;

    function isEntitiesV2(url) {
      try {
        return String(url || '').includes(TARGET);
      } catch {
        return false;
      }
    }

    function headersToObject(headers) {
      try {
        if (!headers) return null;
        const out = {};
        if (typeof headers.forEach === 'function') {
          headers.forEach((v, k) => {
            out[k] = v;
          });
          return out;
        }
        if (Array.isArray(headers)) {
          for (const [k, v] of headers) out[k] = v;
          return out;
        }
        if (typeof headers === 'object') {
          for (const [k, v] of Object.entries(headers)) {
            if (v != null) out[k] = String(v);
          }
          return out;
        }
      } catch {
        /* ignore */
      }
      return null;
    }

    function parseRequestBody(body) {
      try {
        if (body == null) return null;
        if (typeof body === 'string') {
          const t = body.trim();
          if (!t) return null;
          return JSON.parse(t);
        }
        if (
          typeof body === 'object' &&
          !(body instanceof FormData) &&
          !(body instanceof Blob) &&
          !(typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer)
        ) {
          return body;
        }
      } catch {
        /* ignore */
      }
      return null;
    }

    function safePost(url, requestBody, data) {
      try {
        window.postMessage(
          {
            type: CAPTURE_TYPE,
            url: String(url || ''),
            requestBody: requestBody || null,
            requestHeaders: lastHeaders,
            data,
          },
          location.origin,
        );
        if (DEBUG) {
          const tab = requestBody?.tileCountTab || '?';
          // eslint-disable-next-line no-console
          console.log('[RelayCapture MAIN] entitiesV2 captured', tab);
        }
      } catch {
        /* ignore */
      }
    }

    // --- fetch ---
    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = async function relayCaptureFetch(input, init) {
        let reqUrl = '';
        let reqBody = null;
        try {
          reqUrl =
            typeof input === 'string'
              ? input
              : input && typeof input.url === 'string'
                ? input.url
                : String(input);
          if (isEntitiesV2(reqUrl)) {
            const rawBody =
              init?.body != null ? init.body : input && input.body != null ? input.body : null;
            reqBody = parseRequestBody(rawBody);
            const hdrs = headersToObject(init?.headers) || headersToObject(input?.headers);
            if (hdrs) lastHeaders = hdrs;
          }
        } catch {
          /* ignore */
        }

        const res = await originalFetch.apply(this, arguments);

        try {
          if (isEntitiesV2(reqUrl)) {
            res
              .clone()
              .json()
              .then((data) => safePost(reqUrl, reqBody, data))
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
      const originalSetRequestHeader = XHR.prototype.setRequestHeader;

      XHR.prototype.open = function relayCaptureOpen(method, url) {
        try {
          this.__relayCaptureUrl = String(url || '');
          this.__relayCaptureHeaders = {};
        } catch {
          /* ignore */
        }
        return originalOpen.apply(this, arguments);
      };

      XHR.prototype.setRequestHeader = function relayCaptureSetHeader(name, value) {
        try {
          if (this.__relayCaptureHeaders) {
            this.__relayCaptureHeaders[name] = value;
          }
        } catch {
          /* ignore */
        }
        return originalSetRequestHeader.apply(this, arguments);
      };

      XHR.prototype.send = function relayCaptureSend(body) {
        try {
          const url = this.__relayCaptureUrl || '';
          if (isEntitiesV2(url)) {
            this.__relayCaptureRequestBody = parseRequestBody(body);
            if (this.__relayCaptureHeaders && Object.keys(this.__relayCaptureHeaders).length) {
              lastHeaders = { ...this.__relayCaptureHeaders };
            }
            this.addEventListener(
              'load',
              function onLoad() {
                try {
                  const text =
                    typeof this.responseText === 'string'
                      ? this.responseText
                      : typeof this.response === 'string'
                        ? this.response
                        : '';
                  if (!text) return;
                  const data = JSON.parse(text);
                  safePost(url, this.__relayCaptureRequestBody || null, data);
                } catch {
                  /* ignore */
                }
              },
              { once: true },
            );
          }
        } catch {
          /* ignore */
        }
        return originalSend.apply(this, arguments);
      };
    }

    // Optional History pagination: isolated → MAIN fetch with same credentials/headers
    window.addEventListener('message', (e) => {
      try {
        if (e.source !== window) return;
        const msg = e.data;
        if (!msg || msg.type !== FETCH_REQ) return;
        const { requestId, url, body } = msg;
        (async () => {
          try {
            const headers = {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              ...(lastHeaders || {}),
            };
            // Ensure JSON body content-type
            headers['Content-Type'] = 'application/json';
            const res = await originalFetch(url || `https://relay.amazon.com${TARGET}`, {
              method: 'POST',
              credentials: 'include',
              headers,
              body: JSON.stringify(body || {}),
            });
            const data = await res.json();
            window.postMessage(
              { type: FETCH_RES, requestId, ok: res.ok, status: res.status, data },
              location.origin,
            );
          } catch (err) {
            window.postMessage(
              {
                type: FETCH_RES,
                requestId,
                ok: false,
                error: String(err?.message || err),
              },
              location.origin,
            );
          }
        })();
      } catch {
        /* ignore */
      }
    });

    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.log('[RelayCapture MAIN] entitiesV2 hooks installed');
    }
  } catch {
    /* never break the page */
  }
})();
