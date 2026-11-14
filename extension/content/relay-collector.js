/**
 * Authorized collection only: visible DOM text on pages the user has open
 * while logged into Amazon Relay in the browser. No cookies stored, no
 * auth bypass, no undocumented private APIs.
 *
 * Supports current Relay Trips SPA (card/list + in-page expand), not only
 * classic HTML tables.
 */

(() => {
  if (window.__internalSysRelayCollector) return;
  window.__internalSysRelayCollector = true;

  const MONTHS = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };

  const SECTION_RULES = [
    { id: 'payments', test: (u) => /payment|settlement|invoice/i.test(u) },
    {
      id: 'load_detail',
      test: (u) => /\/(tour|tours|trip|trips|load|loads)\/[A-Za-z0-9_-]+/i.test(u),
    },
    {
      id: 'tours',
      test: (u) =>
        /\/(tours?|trips?|loads?|work|loadboard|my-?loads|schedule)/i.test(u),
    },
  ];

  function detectSection() {
    const url = location.href;
    for (const rule of SECTION_RULES) {
      if (rule.test(url)) return rule.id;
    }
    const text = document.body?.innerText?.slice(0, 8000) || '';
    if (/payment|settlement|invoice|payout/i.test(text) && /amount|paid|pending/i.test(text)) {
      return 'payments';
    }
    // Trips board: "N-M of N results" + trip ids like T-XXXX
    if (
      /\bT-[A-Z0-9]{5,}\b/i.test(text) ||
      /\b\d+-\d+\s+of\s+\d+\s+results\b/i.test(text) ||
      /\b(trips?|tours?|my loads)\b/i.test(document.title + ' ' + text.slice(0, 500))
    ) {
      return /trailer\s*id|tractor\s*id|equipment|stops|arrival|departure/i.test(text)
        ? 'tours'
        : 'tours';
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

    // Fri, Nov 13, 04:01 PST  OR  Nov 13, 2026
    let m = s.match(
      /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i,
    );
    if (!m) {
      // 13 Nov, 03:02 PST
      m = s.match(/\b(\d{1,2})\s+([A-Za-z]+)(?:,?\s*(\d{4}))?/i);
      if (m) m = [m[0], m[2], m[1], m[3]];
    }
    if (!m) {
      m = s.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
    }
    if (m) {
      const mon = MONTHS[String(m[1]).toLowerCase()];
      if (mon != null) {
        const year = m[3] ? Number(m[3]) : new Date().getFullYear();
        const day = String(m[2]).padStart(2, '0');
        const mm = String(mon + 1).padStart(2, '0');
        return `${year}-${mm}-${day}`;
      }
    }

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
    if (
      /in[\s-]?transit|en[\s-]?route|on[\s-]?route|loaded|picked\s*up|departed|arrived|chk\.?\s*in|preloaded/i.test(
        s,
      )
    ) {
      return 'In Transit';
    }
    if (/dispatch/i.test(s)) return 'Dispatched';
    if (/book|confirm|award|spot/i.test(s)) return 'Booked';
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

  function inferStatusFromText(text) {
    return (
      mapLoadStatus(text) ||
      (/\b(departed|arrived|chk\.?\s*in|in transit)\b/i.test(text)
        ? 'In Transit'
        : /\b(complete|delivered)\b/i.test(text)
          ? 'Completed'
          : 'Booked')
    );
  }

  function normalizeTrailer(raw) {
    if (!raw) return null;
    const s = String(raw).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const m = s.match(/\b(?:[A-Z]{2,4}\s+)?[A-Z]?\d{4,}\b/i);
    return (m ? m[0] : s).slice(0, 40);
  }

  function parseTripBlock(block, section) {
    const tripMatch = block.match(/\b(T-[A-Z0-9]{5,})\b/i);
    const loadMatch = block.match(/\b([0-9]{2,3}[A-Z0-9]{5,})\b/);
    const loadId = tripMatch?.[1] || loadMatch?.[1];
    if (!loadId) return null;

    // Route: APC2 … → SBD3 …   or  APC2 → MARS...
    const arrow = block.match(
      /([A-Z0-9_]{3,}[^\n→\-]{0,40}?)\s*(?:→|->|–|-)\s*([A-Z0-9_]{3,}[^\n]{0,40})/i,
    );
    const payout = parseMoney(
      (block.match(/\$\s*[\d,]+(?:\.\d{2})?/) || [])[0] ||
        extractLabeledValue(block, ['Payout', 'Rate', 'Total payout']),
    );
    const miles = parseMiles(
      (block.match(/([\d,.]+)\s*mi\b/i) || [])[1] ||
        extractLabeledValue(block, ['Distance', 'Miles']),
    );
    const driver =
      extractLabeledValue(block, ['Driver', 'Assigned driver']) ||
      (block.match(/\b([A-Z]\.\s*[A-Z][a-z]+|[A-Z][a-z]+\s+[A-Z][a-z]+)\b/) || [])[1] ||
      null;

    const trailerRaw =
      extractLabeledValue(block, ['Trailer ID', 'Trailer']) ||
      (block.match(/Trailer(?:\s*ID)?\s*[:\s]*([A-Z]{0,4}\s*[A-Z]?\d{4,})\b/i) || [])[1] ||
      null;

    const equipment =
      extractLabeledValue(block, ['Equipment', 'Trailer type']) ||
      (block.match(/\b(\d{2}'\s*Trailer(?:\s*\([A-Z]\))?)/i) || [])[1] ||
      null;

    // Dates near route / schedule lines
    const dateHits = [...block.matchAll(
      /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+[A-Za-z]+\s+\d{1,2}(?:,?\s*\d{4})?(?:\s*,?\s*\d{1,2}:\d{2}\s*(?:PST|PDT|EST|EDT|CST|CDT|MST|MDT)?)?/gi,
    )].map((x) => x[0]);
    const altDates = [...block.matchAll(
      /\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{1,2}:\d{2}\s*(?:PST|PDT|EST|EDT|CST|CDT|MST|MDT)?/gi,
    )].map((x) => x[0]);
    const dates = dateHits.length ? dateHits : altDates;

    function cleanLoc(s) {
      return String(s || '')
        .replace(/\s+/g, ' ')
        .replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*.*$/i, '')
        .trim()
        .slice(0, 120);
    }
    const pickupLoc = arrow
      ? cleanLoc(arrow[1])
      : extractLabeledValue(block, ['Pickup', 'Origin', 'From']);
    const deliveryLoc = arrow
      ? cleanLoc(arrow[2])
      : extractLabeledValue(block, ['Delivery', 'Destination', 'To', 'Drop']);

    const status = inferStatusFromText(block);

    return {
      load_id: String(loadId).trim(),
      amazon_ref_id: tripMatch && loadMatch && loadMatch[1] !== tripMatch[1] ? loadMatch[1] : tripMatch?.[1] || loadMatch?.[1] || null,
      load_status: status,
      payment_status: null,
      pickup_location: pickupLoc,
      delivery_location: deliveryLoc,
      pickup_date: parseDate(dates[0] || extractLabeledValue(block, ['Pickup date', 'Start date', 'Arrival'])),
      delivery_date: parseDate(
        dates[1] || dates[0] || extractLabeledValue(block, ['Delivery date', 'End date', 'Departure']),
      ),
      trailer_id: normalizeTrailer(trailerRaw),
      trailer_type: equipment,
      distance_miles: miles,
      rate_gross: payout,
      additional_charges: null,
      payment_date: null,
      driver_name_raw: driver ? String(driver).trim() : null,
      notes: null,
      observed_url: location.href,
      section,
    };
  }

  function collectTripsFromCards() {
    const loads = [];
    const seen = new Set();

    // Prefer anchors / buttons that look like trip ids
    const anchors = [...document.querySelectorAll('a, button, [role="link"], span, div')].filter(
      (el) => {
        const t = (el.innerText || el.textContent || '').trim();
        return /^T-[A-Z0-9]{5,}$/i.test(t) || /^[0-9]{2,3}[A-Z0-9]{5,}$/.test(t);
      },
    );

    for (const el of anchors) {
      let node = el;
      let block = '';
      for (let i = 0; i < 8 && node; i++) {
        const text = (node.innerText || '').trim();
        if (text.length > 80 && /mi\b|\$|→|->|driver|payout|spot|trailer|equipment/i.test(text)) {
          block = text;
          break;
        }
        node = node.parentElement;
      }
      if (!block) block = (el.closest('[class], section, article, li, tr') || el).innerText || '';
      const parsed = parseTripBlock(block.slice(0, 4000), 'tours');
      if (!parsed || seen.has(parsed.load_id)) continue;
      seen.add(parsed.load_id);
      loads.push(parsed);
    }

    // Fallback: split page text on trip ids
    if (!loads.length) {
      const body = document.body?.innerText || '';
      const parts = body.split(/(?=T-[A-Z0-9]{5,}\b)/i);
      for (const part of parts) {
        if (!/^T-/i.test(part.trim())) continue;
        const parsed = parseTripBlock(part.slice(0, 3500), 'tours');
        if (!parsed || seen.has(parsed.load_id)) continue;
        seen.add(parsed.load_id);
        loads.push(parsed);
      }
    }

    return loads;
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
        (r) => !r.querySelector('th'),
      );
      for (const row of rows) {
        const cells = cellsFromRow(row);
        if (cells.length < 2) continue;
        const loadId =
          (idIdx >= 0 ? cells[idIdx] : null) ||
          cells.find((c) => /^(T-)?[A-Z0-9-]{6,}$/i.test(c) && !/\$/.test(c));
        if (!loadId) continue;
        const statusRaw = statusIdx >= 0 ? cells[statusIdx] : null;
        const load = {
          load_id: String(loadId).trim(),
          amazon_ref_id: refIdx >= 0 ? cells[refIdx] : null,
          load_status: mapLoadStatus(statusRaw) || statusRaw || inferStatusFromText(cells.join(' ')),
          payment_status: null,
          pickup_location: pickupIdx >= 0 ? cells[pickupIdx] : null,
          delivery_location: deliveryIdx >= 0 ? cells[deliveryIdx] : null,
          pickup_date: pickupDateIdx >= 0 ? parseDate(cells[pickupDateIdx]) : null,
          delivery_date: deliveryDateIdx >= 0 ? parseDate(cells[deliveryDateIdx]) : null,
          trailer_id: trailerIdx >= 0 ? normalizeTrailer(cells[trailerIdx]) : null,
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

  function collectExpandedDetail() {
    const text = document.body?.innerText || '';
    // Expanded stop/equipment panel on Trips board
    if (!/Trailer|Tractor|Arrival|Departure|Stop/i.test(text)) return [];

    // Prefer expanded load id under a trip, else trip id
    const focus =
      text.match(/\b(T-[A-Z0-9]{5,})\b[\s\S]{0,1200}?Trailer/i) ||
      text.match(/\b([0-9]{2,3}[A-Z0-9]{5,})\b[\s\S]{0,800}?Trailer/i);
    const block = focus ? focus[0] : text.slice(0, 6000);
    const parsed = parseTripBlock(block, 'load_detail');
    if (!parsed) return [];

    const trailer =
      normalizeTrailer(
        extractLabeledValue(block, ['Trailer ID', 'Trailer']) ||
          (block.match(/Trailer(?:\s*ID)?\s*[:\s]*([A-Z0-9][A-Z0-9\s-]{3,24})/i) || [])[1],
      ) || parsed.trailer_id;

    if (trailer) parsed.trailer_id = trailer;
    parsed.section = 'load_detail';
    // Ensure required CRM fields for sync when detail is expanded
    if (!parsed.load_status) parsed.load_status = inferStatusFromText(block);
    return [parsed];
  }

  function collectLoadDetail() {
    const fromExpand = collectExpandedDetail();
    if (fromExpand.length) return fromExpand;

    const text = document.body?.innerText || '';
    const loadId =
      extractLabeledValue(text, ['Load ID', 'Tour ID', 'Trip ID', 'Work ID']) ||
      (text.match(/\b(T-[A-Z0-9]{5,})\b/i) || [])[1] ||
      location.pathname.split('/').filter(Boolean).pop();
    if (!loadId || /^(tours|trips|loads|work|payment)/i.test(loadId)) return [];
    const statusRaw = extractLabeledValue(text, ['Status', 'Load status', 'Tour status']);
    const fuel = parseMoney(extractLabeledValue(text, ['Fuel surcharge', 'Fuel']));
    const tolls = parseMoney(extractLabeledValue(text, ['Toll', 'Tolls', 'Toll charges']));
    const base = parseMoney(extractLabeledValue(text, ['Base rate', 'Rate', 'Payout', 'Total payout']));
    const additional = fuel != null || tolls != null ? (fuel || 0) + (tolls || 0) : null;
    return [
      {
        load_id: String(loadId).trim(),
        amazon_ref_id: extractLabeledValue(text, ['Amazon reference', 'Reference', 'Confirmation']),
        load_status: mapLoadStatus(statusRaw) || statusRaw || inferStatusFromText(text),
        payment_status: null,
        pickup_location: extractLabeledValue(text, ['Pickup', 'Origin', 'From']),
        delivery_location: extractLabeledValue(text, ['Delivery', 'Destination', 'To']),
        pickup_date: parseDate(extractLabeledValue(text, ['Pickup date', 'Start date', 'Depart'])),
        delivery_date: parseDate(extractLabeledValue(text, ['Delivery date', 'End date', 'Arrive'])),
        trailer_id: normalizeTrailer(extractLabeledValue(text, ['Trailer', 'Trailer ID'])),
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
        (r) => !r.querySelector('th'),
      );
      for (const row of rows) {
        const cells = cellsFromRow(row);
        if (cells.length < 2) continue;
        const reference = refIdx >= 0 ? cells[refIdx] : cells[0];
        const amount =
          amountIdx >= 0 ? parseMoney(cells[amountIdx]) : parseMoney(cells.find((c) => /\$/.test(c)));
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

  function mergeLoads(primary, secondary) {
    const map = new Map();
    for (const load of [...primary, ...secondary]) {
      if (!load?.load_id) continue;
      const prev = map.get(load.load_id) || {};
      map.set(load.load_id, {
        ...prev,
        ...Object.fromEntries(Object.entries(load).filter(([, v]) => v != null && v !== '')),
      });
    }
    return [...map.values()];
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

    // Trips/tours board: scrape cards + tables; expanded row also fills detail
    if (section === 'tours') {
      const cardLoads = collectTripsFromCards();
      const tableLoads = collectLoadsFromTables();
      const detailLoads = collectExpandedDetail();
      const loads = mergeLoads(mergeLoads(cardLoads, tableLoads), detailLoads);
      return {
        section: 'tours',
        loads,
        detail_detected: detailLoads.some((l) => l.trailer_id),
        payments: [],
        pageTitle: document.title,
        url: location.href,
      };
    }

    // Dedicated detail URL or heuristic detail
    const detail = collectLoadDetail();
    return {
      section: 'load_detail',
      loads: detail,
      detail_detected: detail.some((l) => l.trailer_id),
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
