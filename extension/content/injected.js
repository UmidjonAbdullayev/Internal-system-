/**
 * MAIN-world hooks — capture ONLY POST /api/tours/entitiesV2.
 * Also serves scheduled fetches for always-on sync (same credentials).
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

    let lastHeaders = null;

    function isEntitiesV2(url) {
      try {
        return String(url || '').includes(TARGET);
      } catch {
        return false;
      }
    }

    function stripCookieHeaders(headers) {
      if (!headers || typeof headers !== 'object') return {};
      const out = {};
      for (const [k, v] of Object.entries(headers)) {
        if (/^cookie$/i.test(k) || /^set-cookie$/i.test(k)) continue;
        if (/^content-length$/i.test(k)) continue;
        if (v != null) out[k] = String(v);
      }
      return out;
    }

    function headersToObject(headers) {
      try {
        if (!headers) return null;
        const out = {};
        if (typeof headers.forEach === 'function') {
          headers.forEach((v, k) => {
            out[k] = v;
          });
          return stripCookieHeaders(out);
        }
        if (Array.isArray(headers)) {
          for (const [k, v] of headers) out[k] = v;
          return stripCookieHeaders(out);
        }
        if (typeof headers === 'object') return stripCookieHeaders(headers);
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
            if (hdrs && Object.keys(hdrs).length) lastHeaders = hdrs;
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
                /* ignore non-json */
              });
          }
        } catch {
          /* ignore */
        }
        return res;
      };
    }

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
          if (this.__relayCaptureHeaders) this.__relayCaptureHeaders[name] = value;
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
              lastHeaders = stripCookieHeaders(this.__relayCaptureHeaders);
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

    // Always-on / scheduled fetch: isolated → MAIN with template headers
    window.addEventListener('message', (e) => {
      try {
        if (e.source !== window) return;
        const msg = e.data;
        if (!msg || msg.type !== FETCH_REQ) return;
        const { requestId, url, body, headers: tplHeaders } = msg;
        (async () => {
          try {
            const headers = {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              ...stripCookieHeaders(lastHeaders || {}),
              ...stripCookieHeaders(tplHeaders || {}),
            };
            headers['Content-Type'] = 'application/json';
            delete headers.Cookie;
            delete headers.cookie;

            const res = await originalFetch(url || `https://relay.amazon.com${TARGET}`, {
              method: 'POST',
              credentials: 'include',
              headers,
              body: JSON.stringify(body || {}),
              redirect: 'follow',
            });

            const ct = res.headers?.get?.('content-type') || '';
            const finalUrl = res.url || '';
            if (/signin|ap\/signin|login/i.test(finalUrl) || res.status === 401 || res.status === 403) {
              window.postMessage(
                {
                  type: FETCH_RES,
                  requestId,
                  ok: false,
                  status: res.status || 401,
                  authRequired: true,
                  error: 'Log in to Relay',
                },
                location.origin,
              );
              return;
            }

            if (!/json/i.test(ct)) {
              const text = await res.text().catch(() => '');
              const auth =
                /signin|Sign in|amazon\.com\/ap\//i.test(text) ||
                /signin|login/i.test(finalUrl);
              window.postMessage(
                {
                  type: FETCH_RES,
                  requestId,
                  ok: false,
                  status: res.status,
                  authRequired: auth,
                  error: auth ? 'Log in to Relay' : `Non-JSON response (${res.status})`,
                },
                location.origin,
              );
              return;
            }

            const data = await res.json();
            // Scheduled fetches also emit capture so template/passive path stays warm
            if (res.ok) safePost(url || TARGET, body, data);
            window.postMessage(
              {
                type: FETCH_RES,
                requestId,
                ok: res.ok,
                status: res.status,
                data: res.ok ? data : null,
                error: res.ok ? null : `HTTP ${res.status}`,
              },
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
