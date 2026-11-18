/**
 * MAIN-world hooks — capture entitiesV2 POST + financials GET.
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
    const FIN_FETCH_REQ = '__RELAY_FETCH_FINANCIALS_REQ__';
    const FIN_FETCH_RES = '__RELAY_FETCH_FINANCIALS_RES__';
    const TARGET = '/api/tours/entitiesV2';
    const SETTLEMENTS = '/api/financials/v1/settlements';
    const PAYMENTS_SUMMARY = '/api/financials/v1/payments-summary';
    const DEBUG = true;

    let lastHeaders = null;

    function isEntitiesV2(url) {
      try {
        return String(url || '').includes(TARGET);
      } catch {
        return false;
      }
    }

    function financialKind(url) {
      try {
        const u = String(url || '');
        if (u.includes(SETTLEMENTS)) return 'settlements';
        if (u.includes(PAYMENTS_SUMMARY)) return 'payments-summary';
      } catch {
        /* ignore */
      }
      return null;
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

    function safePost(url, requestBody, data, kind) {
      try {
        window.postMessage(
          {
            type: CAPTURE_TYPE,
            url: String(url || ''),
            requestBody: requestBody || null,
            requestHeaders: lastHeaders,
            data,
            captureKind: kind || null,
          },
          location.origin,
        );
        if (DEBUG) {
          if (kind) {
            // eslint-disable-next-line no-console
            console.log('[RelayCapture MAIN] financials captured', kind);
          } else {
            const tab = requestBody?.tileCountTab || '?';
            // eslint-disable-next-line no-console
            console.log('[RelayCapture MAIN] entitiesV2 captured', tab);
          }
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
        let finKind = null;
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
          } else {
            finKind = financialKind(reqUrl);
            if (finKind) {
              const hdrs = headersToObject(init?.headers) || headersToObject(input?.headers);
              if (hdrs && Object.keys(hdrs).length) lastHeaders = hdrs;
            }
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
              .then((data) => safePost(reqUrl, reqBody, data, null))
              .catch(() => {
                /* ignore non-json */
              });
          } else if (finKind) {
            res
              .clone()
              .json()
              .then((data) => safePost(reqUrl, null, data, finKind))
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

    const XHR = window.XMLHttpRequest;
    if (typeof XHR === 'function') {
      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;
      const originalSetRequestHeader = XHR.prototype.setRequestHeader;

      XHR.prototype.open = function relayCaptureOpen(method, url) {
        try {
          this.__relayCaptureUrl = String(url || '');
          this.__relayCaptureMethod = String(method || 'GET');
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
                  safePost(url, this.__relayCaptureRequestBody || null, data, null);
                } catch {
                  /* ignore */
                }
              },
              { once: true },
            );
          } else {
            const kind = financialKind(url);
            if (kind) {
              if (this.__relayCaptureHeaders && Object.keys(this.__relayCaptureHeaders).length) {
                lastHeaders = stripCookieHeaders(this.__relayCaptureHeaders);
              }
              this.addEventListener(
                'load',
                function onFinLoad() {
                  try {
                    const text =
                      typeof this.responseText === 'string'
                        ? this.responseText
                        : typeof this.response === 'string'
                          ? this.response
                          : '';
                    if (!text) return;
                    const data = JSON.parse(text);
                    safePost(url, null, data, kind);
                  } catch {
                    /* ignore */
                  }
                },
                { once: true },
              );
            }
          }
        } catch {
          /* ignore */
        }
        return originalSend.apply(this, arguments);
      };
    }

    function postAuthOrError(type, requestId, res, finalUrl, url) {
      const ct = res.headers?.get?.('content-type') || '';
      if (/signin|ap\/signin|login/i.test(finalUrl) || res.status === 401 || res.status === 403) {
        window.postMessage(
          {
            type,
            requestId,
            ok: false,
            status: res.status || 401,
            authRequired: true,
            error: 'Log in to Relay',
            url,
            at: new Date().toISOString(),
          },
          location.origin,
        );
        return true;
      }
      if (!/json/i.test(ct)) {
        window.postMessage(
          {
            type,
            requestId,
            ok: false,
            status: res.status,
            authRequired: /signin|login/i.test(finalUrl),
            error: `Non-JSON response (${res.status})`,
            url,
            at: new Date().toISOString(),
          },
          location.origin,
        );
        return true;
      }
      return false;
    }

    // Always-on / scheduled fetch: isolated → MAIN with template headers
    window.addEventListener('message', (e) => {
      try {
        if (e.source !== window) return;
        const msg = e.data;
        if (!msg) return;

        if (msg.type === FETCH_REQ) {
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

              const finalUrl = res.url || '';
              if (postAuthOrError(FETCH_RES, requestId, res, finalUrl, url || TARGET)) return;

              const data = await res.json();
              if (res.ok) safePost(url || TARGET, body, data, null);
              window.postMessage(
                {
                  type: FETCH_RES,
                  requestId,
                  ok: res.ok,
                  status: res.status,
                  context: 'page',
                  url: url || `https://relay.amazon.com${TARGET}`,
                  data: res.ok ? data : null,
                  error: res.ok ? null : `HTTP ${res.status}`,
                  at: new Date().toISOString(),
                },
                location.origin,
              );
            } catch (err) {
              window.postMessage(
                {
                  type: FETCH_RES,
                  requestId,
                  ok: false,
                  status: null,
                  context: 'page',
                  url: url || `https://relay.amazon.com${TARGET}`,
                  error: String(err?.message || err),
                  at: new Date().toISOString(),
                },
                location.origin,
              );
            }
          })();
          return;
        }

        if (msg.type === FIN_FETCH_REQ) {
          const { requestId, url, headers: tplHeaders } = msg;
          (async () => {
            try {
              const headers = {
                Accept: 'application/json',
                ...stripCookieHeaders(lastHeaders || {}),
                ...stripCookieHeaders(tplHeaders || {}),
              };
              delete headers.Cookie;
              delete headers.cookie;
              delete headers['Content-Type'];
              delete headers['content-type'];

              const res = await originalFetch(url, {
                method: 'GET',
                credentials: 'include',
                headers,
                redirect: 'follow',
              });

              const finalUrl = res.url || '';
              const kind = financialKind(url);
              if (postAuthOrError(FIN_FETCH_RES, requestId, res, finalUrl, url)) return;

              const data = await res.json();
              if (res.ok) safePost(url, null, data, kind);
              window.postMessage(
                {
                  type: FIN_FETCH_RES,
                  requestId,
                  ok: res.ok,
                  status: res.status,
                  context: 'page',
                  url,
                  kind,
                  data: res.ok ? data : null,
                  error: res.ok ? null : `HTTP ${res.status}`,
                  at: new Date().toISOString(),
                },
                location.origin,
              );
            } catch (err) {
              window.postMessage(
                {
                  type: FIN_FETCH_RES,
                  requestId,
                  ok: false,
                  status: null,
                  context: 'page',
                  url,
                  error: String(err?.message || err),
                  at: new Date().toISOString(),
                },
                location.origin,
              );
            }
          })();
        }
      } catch {
        /* ignore */
      }
    });

    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.log('[RelayCapture MAIN] entitiesV2 + financials hooks installed');
    }
  } catch {
    /* never break the page */
  }
})();
