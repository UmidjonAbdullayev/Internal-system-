/**
 * Authorized collection only: visible DOM text on pages the user has open
 * while logged into Amazon Relay in the browser. No cookies stored, no
 * auth bypass, no undocumented private APIs.
 */

(() => {
  if (window.__internalSysRelayCollector) return;
  window.__internalSysRelayCollector = true;

  const SECTION_RULES = [
    { id: 'payments', test: (u) => /payment|settlement|invoice/i.test(u) },
    { id: 'load_detail', test: (u) => /\/(tour|load|loads)\/[A-Za-z0-9_-]+/i.test(u) },
    { id: 'tours', test: (u) => /\/(tours|loads|work|loadboard|my-?loads)/i.test(u) },
  ];

  function detectSection() {
    const url = location.href;
    for (const rule of SECTION_RULES) {
      if (rule.test(url)) return rule.id;
    }
    // Heuristic from visible headings when URL is ambiguous
    const text = document.body?.innerText?.slice(0, 4000) || '';
    if (/payment|settlement|invoice|payout/i.test(text) && /amount|paid|pending/i.test(text)) {
      return 'payments';
    }
    if (/tour|load id|pickup|delivery|origin|destination/i.test(text)) {
      return /trailer|equipment|stops|rate breakdown/i.test(text) ? 'load_detail' : 'tours';
    }
    return null;
  }

  function cellsFromRow(row) {
    return [...row.querySelectorAll('td, [role="cell"], .cell, [data-testid*="cell"]')]
      .map((el) => (el.innerText || el.textContent || '').trim())
      .filter(Boolean);
  }

  function headersFromTable(table) {
    const ths = [...table.querySelectorAll('th, [role="columnheader"]')];
    if (ths.length) return ths.map((el) => (el.innerText || '').trim().toLowerCase());
    const first = table.querySelector('tr, [role="row"]');
    if (!first) return [];
    return cellsFromRow(first).map((c) => c.toLowerCase());
  }

  function indexOfHeader(headers, patterns) {
    for (let i = 0; i < headers.length; i++) {
      if (patterns.some((re) => re.test(headers[i]))) return i;
    }
    return -1;
  }

  function parseMoney(raw) {
    if (raw == null || raw === '') return null;
    const n = Number(String(raw).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  function parseMiles(raw) {
    if (raw == null || raw === '') return null;
    const n = Number(String(raw).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
  }

  function parseDate(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    const iso = s.match(/(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const mdy = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (mdy) {
      const year = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
      return `${year}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  function mapLoadStatus(raw) {
    if (!raw) return null;
    const s = String(raw);
    if (/cancel/i.test(s)) return 'Cancelled';
    if (/reject/i.test(s)) return 'Rejected';
    if (/complete/i.test(s)) return 'Completed';
    if (/deliver/i.test(s)) return 'Delivered';
    if (/in[\s-]?transit|en[\s-]?route|on[\s-]?route|loaded|picked\s*up/i.test(s)) return 'In Transit';
    if (/dispatch/i.test(s)) return 'Dispatched';
    if (/book|confirm|award/i.test(s)) return 'Booked';
    if (/available|open/i.test(s)) return 'Available';
    return null;
  }

  function mapPaymentStatus(raw) {
    if (!raw) return null;
    const s = String(raw);
    if (/disput/i.test(s)) return 'Disputed';
    if (/hold/i.test(s)) return 'On Hold';
    if (/paid|settled|deposited/i.test(s)) return 'Paid';
    if (/process/i.test(s)) return 'Processing';
    if (/pend/i.test(s)) return 'Pending';
    if (/not\s*received|unpaid|outstanding/i.test(s)) return 'Not Received';
    return null;
  }

  function extractLabeledValue(rootText, labels) {
    for (const label of labels) {
      const re = new RegExp(`${label}\\s*[:#]?\\s*([^\\n|]{2,80})`, 'i');
      const m = rootText.match(re);
      if (m) return m[1].trim();
    }
    return null;
  }

  function collectLoadsFromTables() {
    const loads = [];
    const tables = document.querySelectorAll('table, [role="table"], [data-testid*="table"]');
    tables.forEach((table) => {
      const headers = headersFromTable(table);
      if (!headers.length) return;
      const idIdx = indexOfHeader(headers, [/load\s*id/, /tour/, /trip/, /work\s*id/, /^id$/]);
      const refIdx = indexOfHeader(headers, [/amazon/, /reference/, /ref/, /confirmation/]);
      const statusIdx = indexOfHeader(headers, [/status/, /state/]);
      const pickupIdx = indexOfHeader(headers, [/pickup/, /origin/, /from/]);
      const deliveryIdx = indexOfHeader(headers, [/delivery/, /destination/, /to(?!tal)/, /drop/]);
      const pickupDateIdx = indexOfHeader(headers, [/pickup.*date/, /start.*date/, /depart/]);
      const deliveryDateIdx = indexOfHeader(headers, [/delivery.*date/, /end.*date/, /arrive/]);
      const rateIdx = indexOfHeader(headers, [/rate/, /payout/, /price/, /gross/, /amount/]);
      const milesIdx = indexOfHeader(headers, [/mile/, /distance/]);
      const driverIdx = indexOfHeader(headers, [/driver/, /operator/]);
      const trailerIdx = indexOfHeader(headers, [/trailer/, /equipment/]);

      const rows = [...table.querySelectorAll('tbody tr, [role="row"]')].filter(
        (r) => !r.querySelector('th')
      );
      for (const row of rows) {
        const cells = cellsFromRow(row);
        if (cells.length < 2) continue;
        const loadId =
          (idIdx >= 0 ? cells[idIdx] : null) ||
          cells.find((c) => /^[A-Z0-9-]{6,}$/i.test(c) && !/\$/.test(c));
        if (!loadId) continue;
        const statusRaw = statusIdx >= 0 ? cells[statusIdx] : null;
        const load = {
          load_id: String(loadId).trim(),
          amazon_ref_id: refIdx >= 0 ? cells[refIdx] : null,
          load_status: mapLoadStatus(statusRaw) || statusRaw || null,
          payment_status: null,
          pickup_location: pickupIdx >= 0 ? cells[pickupIdx] : null,
          delivery_location: deliveryIdx >= 0 ? cells[deliveryIdx] : null,
          pickup_date: pickupDateIdx >= 0 ? parseDate(cells[pickupDateIdx]) : null,
          delivery_date: deliveryDateIdx >= 0 ? parseDate(cells[deliveryDateIdx]) : null,
          trailer_id: trailerIdx >= 0 ? cells[trailerIdx] : null,
          trailer_type: null,
          distance_miles: milesIdx >= 0 ? parseMiles(cells[milesIdx]) : null,
          rate_gross: rateIdx >= 0 ? parseMoney(cells[rateIdx]) : null,
          additional_charges: null,
          payment_date: null,
          driver_name_raw: driverIdx >= 0 ? cells[driverIdx] : null,
          notes: null,
          observed_url: location.href,
          section: 'tours',
        };
        loads.push(load);
      }
    });
    return loads;
  }

  function collectLoadDetail() {
    const text = document.body?.innerText || '';
    const loadId =
      extractLabeledValue(text, ['Load ID', 'Tour ID', 'Trip ID', 'Work ID']) ||
      location.pathname.split('/').filter(Boolean).pop();
    if (!loadId) return [];
    const statusRaw = extractLabeledValue(text, ['Status', 'Load status', 'Tour status']);
    const fuel = parseMoney(extractLabeledValue(text, ['Fuel surcharge', 'Fuel']));
    const tolls = parseMoney(extractLabeledValue(text, ['Toll', 'Tolls', 'Toll charges']));
    const base = parseMoney(extractLabeledValue(text, ['Base rate', 'Rate', 'Payout', 'Total payout']));
    const additional =
      fuel != null || tolls != null ? (fuel || 0) + (tolls || 0) : null;
    return [
      {
        load_id: String(loadId).trim(),
        amazon_ref_id: extractLabeledValue(text, ['Amazon reference', 'Reference', 'Confirmation']),
        load_status: mapLoadStatus(statusRaw) || statusRaw,
        payment_status: null,
        pickup_location: extractLabeledValue(text, ['Pickup', 'Origin', 'From']),
        delivery_location: extractLabeledValue(text, ['Delivery', 'Destination', 'To']),
        pickup_date: parseDate(extractLabeledValue(text, ['Pickup date', 'Start date', 'Depart'])),
        delivery_date: parseDate(extractLabeledValue(text, ['Delivery date', 'End date', 'Arrive'])),
        trailer_id: extractLabeledValue(text, ['Trailer', 'Trailer ID']),
        trailer_type: extractLabeledValue(text, ['Equipment', 'Trailer type', 'Equipment type']),
        distance_miles: parseMiles(extractLabeledValue(text, ['Distance', 'Miles', 'Total miles'])),
        rate_gross: base,
        additional_charges: additional,
        payment_date: null,
        driver_name_raw: extractLabeledValue(text, ['Driver', 'Assigned driver']),
        notes: null,
        observed_url: location.href,
        section: 'load_detail',
      },
    ];
  }

  function collectPayments() {
    const payments = [];
    const tables = document.querySelectorAll('table, [role="table"]');
    tables.forEach((table) => {
      const headers = headersFromTable(table);
      const refIdx = indexOfHeader(headers, [/ref/, /invoice/, /payment\s*id/, /confirmation/, /load/]);
      const amountIdx = indexOfHeader(headers, [/amount/, /payout/, /paid/, /total/]);
      const dateIdx = indexOfHeader(headers, [/date/, /paid\s*on/, /payment\s*date/]);
      const statusIdx = indexOfHeader(headers, [/status/]);
      const methodIdx = indexOfHeader(headers, [/method/, /type/]);
      const rows = [...table.querySelectorAll('tbody tr, [role="row"]')].filter(
        (r) => !r.querySelector('th')
      );
      for (const row of rows) {
        const cells = cellsFromRow(row);
        if (cells.length < 2) continue;
        const reference = refIdx >= 0 ? cells[refIdx] : cells[0];
        const amount = amountIdx >= 0 ? parseMoney(cells[amountIdx]) : parseMoney(cells.find((c) => /\$/.test(c)));
        const paymentDate = dateIdx >= 0 ? parseDate(cells[dateIdx]) : null;
        if (!reference && amount == null) continue;
        payments.push({
          reference_id: reference ? String(reference).trim() : null,
          amazon_ref_id: reference ? String(reference).trim() : null,
          amount,
          payment_date: paymentDate,
          method: methodIdx >= 0 ? cells[methodIdx] : 'Amazon Relay',
          payment_status: mapPaymentStatus(statusIdx >= 0 ? cells[statusIdx] : null),
          notes: null,
          observed_url: location.href,
          section: 'payments',
        });
      }
    });

    // Also surface payment status updates keyed by load when labeled on page
    const text = document.body?.innerText || '';
    const loadId = extractLabeledValue(text, ['Load ID', 'Tour ID']);
    const payStatus = mapPaymentStatus(extractLabeledValue(text, ['Payment status', 'Status']));
    const payDate = parseDate(extractLabeledValue(text, ['Payment date', 'Paid on', 'Deposit date']));
    if (loadId && (payStatus || payDate)) {
      payments.push({
        reference_id: loadId,
        amazon_ref_id: loadId,
        load_id: loadId,
        amount: parseMoney(extractLabeledValue(text, ['Amount', 'Payout', 'Total'])),
        payment_date: payDate,
        method: 'Amazon Relay',
        payment_status: payStatus,
        notes: null,
        observed_url: location.href,
        section: 'payments',
      });
    }
    return payments;
  }

  function collect() {
    const section = detectSection();
    if (!section) {
      return { section: null, loads: [], payments: [], pageTitle: document.title, url: location.href };
    }
    if (section === 'payments') {
      return {
        section,
        loads: [],
        payments: collectPayments(),
        pageTitle: document.title,
        url: location.href,
      };
    }
    if (section === 'load_detail') {
      return {
        section,
        loads: collectLoadDetail(),
        payments: [],
        pageTitle: document.title,
        url: location.href,
      };
    }
    return {
      section,
      loads: collectLoadsFromTables(),
      payments: [],
      pageTitle: document.title,
      url: location.href,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'RELAY_COLLECT') {
      try {
        sendResponse({ ok: true, data: collect() });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
      return true;
    }
    if (msg?.type === 'RELAY_PING') {
      sendResponse({ ok: true, section: detectSection(), url: location.href });
      return true;
    }
    return false;
  });
})();
