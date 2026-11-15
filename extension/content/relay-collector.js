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

  function isTripsBoardUrl(url = location.href) {
    const u = String(url || '');
    // /trips, /trips/, /trips?x, /trips#x, /trips/upcoming|in-transit|history
    if (/\/trips?(?:\/(?:upcoming|in[_-]?transit|history|active|all|list)?)?(?:[/?#]|$)/i.test(u)) {
      // Real detail: /trips/T-XXXX or /trip/T-XXXX or /trips/123ABC
      if (/\/trips?\/(T-[A-Za-z0-9]+|[0-9]{2,3}[A-Z0-9]{5,})(?:[/?#]|$)/i.test(u)) return false;
      return true;
    }
    if (/\/(tours?|loads?|work|loadboard|my-?loads|schedule)(?:[/?#]|$)/i.test(u)) {
      if (/\/(tours?|loads?)\/(T-[A-Za-z0-9]+|[0-9]{2,3}[A-Z0-9]{5,})(?:[/?#]|$)/i.test(u)) {
        return false;
      }
      return true;
    }
    return false;
  }

  function isTripsBoardDom() {
    const text = document.body?.innerText?.slice(0, 12000) || '';
    const title = document.title || '';
    if (findTripTabButtons().length >= 2) return true;
    if (/\b(Upcoming|In Transit|History)\b/.test(text) && /\bT-[A-Z0-9]{5,}\b/i.test(text)) {
      return true;
    }
    if (/\b\d+-\d+\s+of\s+\d+\s+results\b/i.test(text) && /\bT-[A-Z0-9]{5,}\b/i.test(text)) {
      return true;
    }
    if (/\b(trips?|tours?|my loads)\b/i.test(title) && /\bT-[A-Z0-9]{5,}\b/i.test(text)) {
      return true;
    }
    return false;
  }

  const SECTION_RULES = [
    { id: 'payments', test: (u) => /payment|settlement|invoice/i.test(u) },
    {
      id: 'tours',
      // Prefer board URLs over detail — /trips/in-transit is tours, not load_detail
      test: (u) => isTripsBoardUrl(u),
    },
    {
      id: 'load_detail',
      test: (u) => {
        if (isTripsBoardUrl(u)) return false;
        return /\/(tour|tours|trip|trips|load|loads)\/[A-Za-z0-9_-]+/i.test(u);
      },
    },
  ];

  function detectSection() {
    const url = location.href;
    // DOM wins when Relay SPA keeps a generic path but shows Trips board chrome
    if (!/payment|settlement|invoice/i.test(url) && (isTripsBoardUrl(url) || isTripsBoardDom())) {
      return 'tours';
    }
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
      return 'tours';
    }
    if (/tour|load id|pickup|delivery|origin|destination/i.test(text)) {
      // Expanded equipment on the board is still tours; only true single-load pages → detail
      if (isTripsBoardDom()) return 'tours';
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

  function isPlausibleRelayDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const [y, m, d] = iso.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      return false;
    }
    const now = new Date();
    const min = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
    const max = new Date(Date.UTC(now.getUTCFullYear() + 1, 11, 31));
    return dt >= min && dt <= max;
  }

  function formatYmd(year, monthIndex, day) {
    const y = Number(year);
    const m = Number(monthIndex);
    const d = Number(day);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    if (y < 2000 || y > 2100 || m < 0 || m > 11 || d < 1 || d > 31) return null;
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return isPlausibleRelayDate(iso) ? iso : null;
  }

  /**
   * Parse Relay schedule strings only. Never fall back to bare `new Date(s)` —
   * that produced Dec 31 / 2044-12-31 / year-0450 from money, "Stop 1", miles.
   * Two-digit years (12/31/44) are rejected.
   */
  function parseDate(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s || s.length > 120) return null;
    if (/^\$/.test(s) || /\bmi\b/i.test(s) || /^T-[A-Z0-9]/i.test(s)) return null;

    const iso = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso && isPlausibleRelayDate(iso[1])) return iso[1];

    const hasWeekday = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(s);
    const hasTime = /\b\d{1,2}:\d{2}\b/.test(s);

    // Fri, Nov 13, 04:01 PST  OR  Nov 13, 2026
    let m = s.match(
      /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i,
    );
    if (!m) {
      const dmy = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})(?:,?\s*(\d{4}))?(?:\s|,|$)/i);
      if (dmy && MONTHS[String(dmy[2]).toLowerCase()] != null) {
        m = [dmy[0], dmy[2], dmy[1], dmy[3]];
      }
    }
    if (!m) {
      const md = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s*(\d{4}))?(?:\s|,|$)/i);
      if (md && MONTHS[String(md[1]).toLowerCase()] != null) m = md;
    }
    if (m) {
      const mon = MONTHS[String(m[1]).toLowerCase()];
      if (mon != null) {
        const year = m[3] ? Number(m[3]) : null;
        // Bare "Nov 20" / "Dec 31" (week headers) need weekday, time, or explicit year
        if (year == null && !hasWeekday && !hasTime) return null;
        return formatYmd(year ?? new Date().getFullYear(), mon, Number(m[2]));
      }
    }

    // 4-digit year only — "12/31/44" must not become 2044-12-31
    const mdy = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
    if (mdy) {
      const month = Number(mdy[1]);
      const day = Number(mdy[2]);
      const year = Number(mdy[3]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return formatYmd(year, month - 1, day);
      }
    }
    return null;
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

  /** Reject schedule dates mistaken for trip/leg IDs (e.g. "Sep 29, 2026"). */
  function isValidRelayLoadId(id) {
    if (id == null) return false;
    const s = String(id).trim();
    if (!s || s.length < 6 || s.length > 40) return false;
    if (/\s/.test(s)) return false;
    if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)/i.test(s)) return false;
    if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(s)) return false;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return false;
    if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(s)) return false;
    return /^T-[A-Z0-9]{5,}$/i.test(s) || /^[0-9]{2,3}[A-Z0-9]{5,}$/i.test(s);
  }

  function detectTripBucket() {
    const selected = document.querySelector(
      '[aria-selected="true"], [role="tab"][aria-current="page"], button[aria-pressed="true"]',
    );
    const selectedText = (selected?.innerText || selected?.textContent || '').trim();
    if (/in\s*transit/i.test(selectedText)) return 'in_transit';
    if (/history/i.test(selectedText)) return 'history';
    if (/upcoming/i.test(selectedText)) return 'upcoming';

    const tabs = [...document.querySelectorAll('button, [role="tab"], a')];
    for (const el of tabs) {
      const t = (el.innerText || '').trim();
      const active =
        el.getAttribute('aria-selected') === 'true' ||
        /selected|active|current/i.test(el.className || '') ||
        el.getAttribute('aria-current') === 'page';
      if (!active) continue;
      if (/in\s*transit/i.test(t)) return 'in_transit';
      if (/^history$/i.test(t)) return 'history';
      if (/^upcoming$/i.test(t)) return 'upcoming';
    }
    return null;
  }

  function findTripTabButtons() {
    const wanted = [
      { bucket: 'upcoming', re: /^upcoming$/i },
      { bucket: 'in_transit', re: /^in\s*transit$/i },
      { bucket: 'history', re: /^history$/i },
    ];
    const found = [];
    const candidates = [...document.querySelectorAll('button, [role="tab"], a')];
    for (const w of wanted) {
      const el = candidates.find((c) => w.re.test((c.innerText || '').trim()));
      if (el) found.push({ bucket: w.bucket, el });
    }
    return found;
  }

  function rgbChannels(color) {
    if (!color) return null;
    const m = String(color).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!m) return null;
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  }

  function classifyStatusFill(bg, border) {
    const c = rgbChannels(bg) || rgbChannels(border);
    if (!c) return null;
    const { r, g, b } = c;
    const isWhite = r > 245 && g > 245 && b > 245;
    const isLightBlue = b > 180 && b > r + 20 && g > 160 && r > 120 && !isWhite;
    const isSolidDark = b > 100 && b > r && b > g && r < 120 && g < 160;
    const isRed = r > 180 && g < 100 && b < 100;
    if (isRed) return 'cancelled';
    if (isSolidDark) return 'arrived';
    if (isLightBlue) return 'loaded_enroute';
    if (isWhite || (r > 230 && g > 230 && b > 230)) return 'pending';
    return null;
  }

  /**
   * Status bar: solid teal circle = arrived facility; light-blue fill = loaded & en route.
   * Reads computed styles on circles near the trip card — works for collapsed rows.
   */
  function scrapeStatusBar(root) {
    const scope = root || document.body;
    const nodes = [
      ...scope.querySelectorAll(
        'circle, [class*="status"], [class*="progress"], [class*="stop"], [data-testid*="status"], span, div',
      ),
    ].slice(0, 120);
    let best = { state: null, stopIndex: null };
    let index = 0;
    for (const el of nodes) {
      const tag = el.tagName.toLowerCase();
      let bg = '';
      let border = '';
      if (tag === 'circle') {
        bg = el.getAttribute('fill') || '';
        border = el.getAttribute('stroke') || '';
        try {
          const cs = getComputedStyle(el);
          if (!bg || bg === 'none') bg = cs.fill || cs.backgroundColor;
          if (!border) border = cs.stroke || cs.borderColor;
        } catch {
          /* ignore */
        }
      } else {
        const rect = el.getBoundingClientRect?.();
        if (!rect || rect.width < 8 || rect.width > 36 || rect.height < 8 || rect.height > 36) {
          continue;
        }
        try {
          const cs = getComputedStyle(el);
          bg = cs.backgroundColor;
          border = cs.borderColor;
          const radius = cs.borderRadius || '';
          if (!/%|px/.test(radius) && !/round|circle|pill/i.test(el.className || '')) continue;
        } catch {
          continue;
        }
      }
      const state = classifyStatusFill(bg, border);
      if (!state || state === 'pending') {
        if (state === 'pending') index += 1;
        continue;
      }
      index += 1;
      // Prefer earliest non-pending "current" stop
      if (!best.state || state === 'arrived' || state === 'loaded_enroute') {
        best = { state, stopIndex: index };
        if (state === 'arrived' || state === 'loaded_enroute') break;
      }
    }

    // Text fallback from aria / titles near status
    if (!best.state) {
      const text = (scope.innerText || '').slice(0, 1500);
      if (/arrived\s*(at)?\s*(facility|stop|yard)?/i.test(text)) {
        best = { state: 'arrived', stopIndex: 1 };
      } else if (/loaded|en[\s-]?route|on[\s-]?the[\s-]?way|in[\s-]?transit/i.test(text)) {
        best = { state: 'loaded_enroute', stopIndex: 1 };
      }
    }
    return best;
  }

  function parseTripBlock(block, section, extras = {}) {
    const tripMatch = block.match(/\b(T-[A-Z0-9]{5,})\b/i);
    const loadMatch = block.match(/\b([0-9]{2,3}[A-Z0-9]{5,})\b/);
    // Prefer T- trip id as load_id (never a schedule date); numeric leg → amazon_ref
    const parentTripId = tripMatch?.[1] ? String(tripMatch[1]).toUpperCase() : null;
    const tripId = parentTripId;
    const legId = loadMatch?.[1] && isValidRelayLoadId(loadMatch[1]) ? String(loadMatch[1]) : null;
    const loadId = (tripId && isValidRelayLoadId(tripId) ? tripId : null) || legId;
    if (!loadId || !isValidRelayLoadId(loadId)) return null;

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
    const tractorRaw =
      extractLabeledValue(block, ['Tractor ID', 'Tractor', 'Power unit', 'Truck']) ||
      (block.match(/Tractor(?:\s*ID)?\s*[:\s]*([A-Z0-9][A-Z0-9\s-]{2,20})/i) || [])[1] ||
      null;

    const equipment =
      extractLabeledValue(block, ['Equipment', 'Trailer type']) ||
      (block.match(/\b(\d{2}'\s*Trailer(?:\s*\([A-Z]\))?)/i) || [])[1] ||
      null;
    const jobType =
      extractLabeledValue(block, ['Work type', 'Job type', 'Program']) ||
      (/\bSpot\b/i.test(block) ? 'Spot' : null);

    // Dates near route / schedule lines
    const dateHits = [...block.matchAll(
      /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+[A-Za-z]+\s+\d{1,2}(?:,?\s*\d{4})?(?:\s*,?\s*\d{1,2}:\d{2}\s*(?:PST|PDT|EST|EDT|CST|CDT|MST|MDT)?)?/gi,
    )].map((x) => x[0]);
    const altDates = [...block.matchAll(
      /\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{1,2}:\d{2}\s*(?:PST|PDT|EST|EDT|CST|CDT|MST|MDT)?/gi,
    )].map((x) => x[0]);
    const dates = dateHits.length ? dateHits : altDates;

    function cleanLoc(s) {
      const cleaned = String(s || '')
        .replace(/\s+/g, ' ')
        .replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*.*$/i, '')
        .replace(/^\$[\d,.]+$/, '')
        .trim()
        .slice(0, 120);
      if (!cleaned || /^\$/.test(cleaned) || /^\/?Live$/i.test(cleaned)) return null;
      if (/^\d[\d,]*\.?\d*$/.test(cleaned)) return null;
      if (cleaned.length < 3) return null;
      return cleaned;
    }
    // Prefer facility codes (e.g. APC2 → SBD3) over money/dash noise
    const facilityArrow = block.match(
      /\b([A-Z]{2,4}\d{1,2}[A-Z0-9]?)\b[^\n]{0,30}?(?:→|->|–)\s*\b([A-Z]{2,4}\d{1,2}[A-Z0-9]?)\b/,
    );
    const pickupLoc = facilityArrow
      ? facilityArrow[1]
      : arrow
        ? cleanLoc(arrow[1])
        : extractLabeledValue(block, ['Pickup', 'Origin', 'From']);
    const deliveryLoc = facilityArrow
      ? facilityArrow[2]
      : arrow
        ? cleanLoc(arrow[2])
        : extractLabeledValue(block, ['Delivery', 'Destination', 'To', 'Drop']);

    const tripBucket = extras.trip_bucket || detectTripBucket();
    let status = inferStatusFromText(block);
    if (tripBucket === 'upcoming' && status === 'In Transit') status = 'Booked';
    if (tripBucket === 'history' && (status === 'Booked' || status === 'In Transit')) {
      status = 'Completed';
    }
    if (tripBucket === 'in_transit') status = status === 'Booked' ? 'In Transit' : status;

    const statusBar = extras.status_bar || { state: null, stopIndex: null };

    // Prefer timed weekday dates; ignore lone "Week of Nov 20" style headers when
    // a real schedule line exists. Never trust unlabeled numeric fragments.
    const timedDates = dates.filter((d) => /\d{1,2}:\d{2}/.test(d));
    const scheduleDates = timedDates.length ? timedDates : dates;
    const pickupDate = parseDate(
      scheduleDates[0] ||
        extractLabeledValue(block, ['Pickup date', 'Start date', 'Depart']),
    );
    const deliveryDate = parseDate(
      scheduleDates[1] ||
        scheduleDates[0] ||
        extractLabeledValue(block, ['Delivery date', 'End date', 'Arrive']),
    );

    return {
      load_id: String(loadId).trim(),
      amazon_ref_id: legId && legId !== String(loadId) ? legId : tripId || legId || null,
      parent_trip_id: parentTripId && String(loadId).toUpperCase() !== parentTripId ? parentTripId : parentTripId,
      load_status: status,
      payment_status: null,
      pickup_location: cleanLoc(pickupLoc) || pickupLoc,
      delivery_location: cleanLoc(deliveryLoc) || deliveryLoc,
      pickup_date: pickupDate,
      delivery_date: deliveryDate,
      trailer_id: normalizeTrailer(trailerRaw),
      tractor_id: tractorRaw ? String(tractorRaw).replace(/\s+/g, ' ').trim().slice(0, 40) : null,
      trailer_type: equipment,
      job_type: jobType,
      trip_bucket: tripBucket,
      status_bar_state: statusBar.state,
      status_stop_index: statusBar.stopIndex,
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

  function collectTripsFromCards(forcedBucket = null) {
    const loads = [];
    const seen = new Set();
    const tripBucket = forcedBucket || detectTripBucket();

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
      let cardRoot = el;
      for (let i = 0; i < 8 && node; i++) {
        const text = (node.innerText || '').trim();
        if (text.length > 80 && /mi\b|\$|→|->|driver|payout|spot|trailer|equipment/i.test(text)) {
          block = text;
          cardRoot = node;
          break;
        }
        node = node.parentElement;
      }
      if (!block) {
        cardRoot = el.closest('[class], section, article, li, tr') || el;
        block = cardRoot.innerText || '';
      }
      const statusBar = scrapeStatusBar(cardRoot);
      const parsed = parseTripBlock(block.slice(0, 4000), 'tours', {
        trip_bucket: tripBucket,
        status_bar: statusBar,
      });
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
        const parsed = parseTripBlock(part.slice(0, 3500), 'tours', {
          trip_bucket: tripBucket,
          status_bar: scrapeStatusBar(document.body),
        });
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
      // Do NOT match bare /tour|trip/ — that grabbed "Tour date" / "Trip date" cells as load_id
      const idIdx = indexOfHeader(headers, [
        /load\s*id/,
        /tour\s*id/,
        /trip\s*id/,
        /work\s*id/,
        /^tour$/,
        /^trip$/,
        /^id$/,
      ]);
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
        const rawId =
          (idIdx >= 0 ? cells[idIdx] : null) ||
          cells.find((c) => /^T-[A-Z0-9]{5,}$/i.test(c)) ||
          cells.find((c) => /^[0-9]{2,3}[A-Z0-9]{5,}$/i.test(c));
        const loadId = rawId && isValidRelayLoadId(rawId) ? String(rawId).trim() : null;
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

  function extractStopAndLateNotes(block) {
    const lateFlags = [];
    const stopBits = [];
    const lines = String(block || '')
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (/\blate\b/i.test(line) && !/template|calculate/i.test(line)) {
        lateFlags.push(line.slice(0, 160));
      }
      if (/\b(arriv(?:al|ed)|depart(?:ure|ed)|stop\s*\d)\b/i.test(line)) {
        const arrival = (line.match(/arriv(?:al|ed)?\s*[:\s]+([^|;]+)/i) || [])[1]?.trim();
        const departure = (line.match(/depart(?:ure|ed)?\s*[:\s]+([^|;]+)/i) || [])[1]?.trim();
        if (arrival || departure || /\bstop\b/i.test(line)) {
          stopBits.push(
            [
              line.slice(0, 120),
              arrival ? `arr=${arrival.slice(0, 40)}` : null,
              departure ? `dep=${departure.slice(0, 40)}` : null,
            ]
              .filter(Boolean)
              .join(' | '),
          );
        }
      }
    }
    const parts = [];
    if (lateFlags.length) parts.push(`Late: ${[...new Set(lateFlags)].slice(0, 5).join(' · ')}`);
    if (stopBits.length) parts.push(`Stops: ${[...new Set(stopBits)].slice(0, 8).join(' · ')}`);
    return parts.length ? parts.join('\n').slice(0, 1500) : null;
  }

  function detailIsRich(load) {
    return Boolean(load?.trailer_id || load?.tractor_id);
  }

  /** Prefer React fiber / props when Relay already hydrated expand data. */
  function readReactEquipment(el, depth = 0) {
    if (!el || depth > 5) return null;
    const key = Object.keys(el).find(
      (k) =>
        k.startsWith('__reactFiber$') ||
        k.startsWith('__reactInternalInstance$') ||
        k.startsWith('__reactProps$'),
    );
    if (!key) return null;
    try {
      let node = el[key];
      for (let i = 0; i < 14 && node; i += 1) {
        const memo = node.memoizedProps || node.pendingProps || null;
        if (memo && typeof memo === 'object') {
          const blob = JSON.stringify(memo).slice(0, 14000);
          if (/\b(trailer|tractor|equipment|arrival|departure)\b/i.test(blob)) {
            const trailer =
              normalizeTrailer(
                (blob.match(/"trailer(?:Id|ID|Number)?"\s*:\s*"([^"]+)"/i) || [])[1] ||
                  (blob.match(/Trailer(?:\s*ID)?[#:\s]+([A-Z0-9][A-Z0-9\s-]{3,24})/i) || [])[1],
              ) || null;
            const tractorRaw =
              (blob.match(/"tractor(?:Id|ID|Number)?"\s*:\s*"([^"]+)"/i) || [])[1] ||
              (blob.match(/Tractor(?:\s*ID)?[#:\s]+([A-Z0-9][A-Z0-9\s-]{2,20})/i) || [])[1] ||
              null;
            const tractor = tractorRaw
              ? String(tractorRaw).replace(/\s+/g, ' ').trim().slice(0, 40)
              : null;
            if (trailer || tractor) {
              return {
                trailer_id: trailer,
                tractor_id: tractor,
                notes: extractStopAndLateNotes(blob),
                detail_method: 'react_props',
              };
            }
          }
        }
        node = node.return || node._owner || null;
      }
    } catch {
      /* revoked / circular */
    }
    return null;
  }

  function findExpandControl(cardRoot) {
    if (!cardRoot) return null;
    const selectors = [
      'button[aria-expanded="false"]',
      '[aria-expanded="false"]',
      'button[aria-label*="expand" i]',
      'button[aria-label*="detail" i]',
      'button[aria-label*="chevron" i]',
      '[data-testid*="expand" i]',
      '[class*="chevron" i]',
      '[class*="Expand" i]',
    ];
    for (const sel of selectors) {
      try {
        const el = cardRoot.querySelector(sel);
        if (el) return el.closest('button, [role="button"], a') || el;
      } catch {
        /* invalid selector in older Chromium — skip */
      }
    }
    const buttons = [...cardRoot.querySelectorAll('button, [role="button"]')].filter((b) => {
      const label = `${b.getAttribute('aria-label') || ''} ${b.className || ''}`;
      return /expand|chevron|caret|detail|toggle|arrow/i.test(label) || b.querySelector('svg');
    });
    return buttons[0] || null;
  }

  function isCardExpanded(cardRoot) {
    if (!cardRoot) return false;
    if (cardRoot.querySelector('[aria-expanded="true"]')) return true;
    const t = cardRoot.innerText || '';
    return /\bTrailer\b/i.test(t) && /\bTractor\b/i.test(t);
  }

  async function bgMessage(payload) {
    try {
      return await chrome.runtime.sendMessage(payload);
    } catch {
      return { ok: false };
    }
  }

  async function getDetailScrapedMap() {
    const res = await bgMessage({ type: 'GET_DETAIL_SCRAPED' });
    return res?.detailScraped || {};
  }

  async function markDetailScraped(rows) {
    const rich = (rows || []).filter((r) => r?.load_id && detailIsRich(r));
    if (!rich.length) return;
    await bgMessage({
      type: 'MARK_DETAIL_SCRAPED',
      rows: rich.map((r) => ({
        load_id: r.load_id,
        trailer_id: r.trailer_id,
        tractor_id: r.tractor_id,
        notes: r.notes || null,
      })),
    });
  }

  function findCardRootForLoadId(loadId) {
    if (!loadId) return null;
    const needle = String(loadId).trim();
    const anchors = [...document.querySelectorAll('a, button, [role="link"], span, div')].filter(
      (el) => (el.innerText || el.textContent || '').trim().toUpperCase() === needle.toUpperCase(),
    );
    for (const el of anchors) {
      let node = el;
      for (let i = 0; i < 8 && node; i += 1) {
        const text = (node.innerText || '').trim();
        if (text.length > 80 && /mi\b|\$|→|->|driver|payout|spot|trailer|equipment/i.test(text)) {
          return node;
        }
        node = node.parentElement;
      }
      const fallback = el.closest('[class], section, article, li, tr') || el;
      if (fallback) return fallback;
    }
    return null;
  }

  function parseDetailFromCard(cardRoot, forcedBucket, section = 'tours') {
    if (!cardRoot) return null;
    const block = (cardRoot.innerText || '').slice(0, 6000);
    const statusBar = scrapeStatusBar(cardRoot);
    const parsed = parseTripBlock(block, section, {
      trip_bucket: forcedBucket || detectTripBucket(),
      status_bar: statusBar,
    });
    if (!parsed) return null;
    const stopNotes = extractStopAndLateNotes(block);
    if (stopNotes) {
      parsed.notes = [parsed.notes, stopNotes].filter(Boolean).join('\n').slice(0, 2000);
    }
    const react = readReactEquipment(cardRoot) || readReactEquipment(cardRoot.firstElementChild);
    if (react) {
      parsed.trailer_id = parsed.trailer_id || react.trailer_id;
      parsed.tractor_id = parsed.tractor_id || react.tractor_id;
      if (react.notes) {
        parsed.notes = [parsed.notes, react.notes].filter(Boolean).join('\n').slice(0, 2000);
      }
      if (react.detail_method) parsed.detail_method = react.detail_method;
    }
    return parsed;
  }

  /**
   * DOM/React first; click-expand when Trailer/Tractor not already visible.
   * Rate-limited; collapses after scrape. Skips IDs already in chrome.storage.
   */
  async function expandAndEnrichLoad(load, opts = {}) {
    const {
      expandDelayMs = 700,
      collapseDelayMs = 280,
      expandJitterMs = 350,
      allowExpand = true,
      softYield = true,
    } = opts;

    if (detailIsRich(load) && load.notes && /Late:|Stops:/.test(load.notes)) {
      return { load, method: 'already_rich', expanded: false };
    }

    const cardRoot = findCardRootForLoadId(load.load_id);
    if (!cardRoot) {
      return { load, method: 'no_card', expanded: false };
    }

    let enriched = parseDetailFromCard(cardRoot, load.trip_bucket, load.section || 'tours');
    if (enriched) {
      load = {
        ...load,
        ...Object.fromEntries(
          Object.entries(enriched).filter(([, v]) => v != null && v !== ''),
        ),
      };
    }

    if (detailIsRich(load) || isCardExpanded(cardRoot)) {
      if (isCardExpanded(cardRoot) && !detailIsRich(load)) {
        enriched = parseDetailFromCard(cardRoot, load.trip_bucket, load.section || 'tours');
        if (enriched) {
          load = {
            ...load,
            ...Object.fromEntries(
              Object.entries(enriched).filter(([, v]) => v != null && v !== ''),
            ),
          };
        }
      }
      load.detail_method = load.detail_method || (detailIsRich(load) ? 'dom' : 'open_no_equip');
      return { load, method: load.detail_method, expanded: false };
    }

    if (!allowExpand) {
      load.detail_method = 'skipped_limit_or_cache';
      return { load, method: load.detail_method, expanded: false };
    }

    const control = findExpandControl(cardRoot);
    if (!control) {
      load.detail_method = 'no_control';
      return { load, method: 'no_control', expanded: false };
    }

    try {
      control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch {
      try {
        control.click();
      } catch {
        load.detail_method = 'click_failed';
        return { load, method: 'click_failed', expanded: false };
      }
    }

    if (softYield) await yieldToUi();
    await sleep(expandDelayMs, expandJitterMs);

    // Detail often mounts on the card or next sibling panel
    const scopes = [cardRoot, cardRoot.nextElementSibling, cardRoot.parentElement].filter(Boolean);
    for (const scope of scopes) {
      const parsed = parseDetailFromCard(scope, load.trip_bucket, load.section || 'tours');
      if (!parsed) continue;
      load = {
        ...load,
        ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v != null && v !== '')),
      };
      if (detailIsRich(load)) break;
    }

    await sleep(collapseDelayMs, Math.min(120, expandJitterMs));
    try {
      const collapse =
        cardRoot.querySelector('[aria-expanded="true"]') ||
        findExpandControl(cardRoot) ||
        control;
      collapse.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch {
      /* leave open if collapse fails */
    }

    load.detail_method = 'click_expand';
    return { load, method: 'click_expand', expanded: true };
  }

  function historySkipUnchanged(load, expandOpts = {}) {
    const skipMap = expandOpts.historySkipMap || {};
    const meta = skipMap[load?.load_id];
    if (!meta?.skipExpand && !meta?.skipUpsert) return null;
    const status = load.load_status || 'Completed';
    const pay = load.payment_status || null;
    const statusMatch = (meta.load_status || 'Completed') === status;
    const payMatch = (meta.payment_status || null) === pay;
    // Bucket change (was active in cache) must NOT skip — need history upsert
    const wasHistory = meta.trip_bucket === 'history';
    if (wasHistory && statusMatch && payMatch) return meta;
    return null;
  }

  async function enrichLoadsWithAutoExpand(loads, expandOpts = {}) {
    const {
      maxExpand = 8,
      expandDelayMs = 700,
      collapseDelayMs = 280,
      expandJitterMs = 350,
      softYield = true,
      scrapedMap = null,
    } = expandOpts;

    const already = scrapedMap || (await getDetailScrapedMap());
    let expandCount = 0;
    let skippedHistory = 0;
    const out = [];

    for (const raw of loads || []) {
      const histSkip = historySkipUnchanged(raw, expandOpts);
      if (histSkip?.skipUpsert) {
        skippedHistory += 1;
        out.push({
          ...raw,
          trip_bucket: 'history',
          load_status: raw.load_status || histSkip.load_status || 'Completed',
          detail_method: 'history_skip_cached',
          history_skip: true,
        });
        continue;
      }

      const prior = already[raw.load_id];
      const skipExpand = Boolean(prior?.hasTrailer || prior?.hasTractor) || Boolean(histSkip?.skipExpand);
      // Still refresh DOM/React without clicking when cached
      const allowExpand = !skipExpand && expandCount < maxExpand && !detailIsRich(raw);
      const { load, method } = await expandAndEnrichLoad(raw, {
        expandDelayMs,
        collapseDelayMs,
        expandJitterMs,
        softYield,
        allowExpand,
      });
      if (method === 'click_expand') expandCount += 1;
      if (softYield && expandCount > 0 && expandCount % 2 === 0) await yieldToUi();
      if (prior && (!load.trailer_id || !load.tractor_id || !load.notes)) {
        load.trailer_id = load.trailer_id || prior.trailer_id || null;
        load.tractor_id = load.tractor_id || prior.tractor_id || null;
        if (!load.notes && prior.notes) load.notes = prior.notes;
        if (skipExpand) load.detail_method = load.detail_method || 'cache_skip_expand';
      }
      out.push(load);
    }

    await markDetailScraped(out.filter((l) => !l.history_skip));
    return { loads: out, expanded: expandCount, history_skipped: skippedHistory };
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
    const tractor =
      extractLabeledValue(block, ['Tractor ID', 'Tractor']) ||
      (block.match(/Tractor(?:\s*ID)?\s*[:\s]*([A-Z0-9][A-Z0-9\s-]{2,20})/i) || [])[1];
    if (tractor) parsed.tractor_id = String(tractor).replace(/\s+/g, ' ').trim().slice(0, 40);
    const stopNotes = extractStopAndLateNotes(block);
    if (stopNotes) parsed.notes = stopNotes;
    parsed.section = 'load_detail';
    // Ensure required CRM fields for sync when detail is expanded
    if (!parsed.load_status) parsed.load_status = inferStatusFromText(block);
    return [parsed];
  }

  function collectLoadDetail() {
    const fromExpand = collectExpandedDetail();
    if (fromExpand.length) return fromExpand;

    const text = document.body?.innerText || '';
    const labeled = extractLabeledValue(text, ['Load ID', 'Tour ID', 'Trip ID', 'Work ID']);
    const fromPath = location.pathname.split('/').filter(Boolean).pop();
    const loadIdCandidate =
      (labeled && isValidRelayLoadId(labeled) ? labeled : null) ||
      (text.match(/\b(T-[A-Z0-9]{5,})\b/i) || [])[1] ||
      (text.match(/\b([0-9]{2,3}[A-Z0-9]{5,})\b/) || [])[1] ||
      (fromPath && isValidRelayLoadId(fromPath) ? fromPath : null);
    const loadId = loadIdCandidate && isValidRelayLoadId(loadIdCandidate) ? String(loadIdCandidate).trim() : null;
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

  function collectVisibleTripsSync(forcedBucket = null) {
    const cardLoads = collectTripsFromCards(forcedBucket);
    const tableLoads = collectLoadsFromTables().map((l) => ({
      ...l,
      trip_bucket: forcedBucket || l.trip_bucket || detectTripBucket(),
    }));
    const detailLoads = collectExpandedDetail().map((l) => ({
      ...l,
      trip_bucket: forcedBucket || l.trip_bucket || detectTripBucket(),
      tractor_id:
        l.tractor_id ||
        (extractLabeledValue(document.body?.innerText || '', ['Tractor ID', 'Tractor']) || null),
      status_bar_state: l.status_bar_state || scrapeStatusBar(document.body).state,
      status_stop_index: l.status_stop_index || scrapeStatusBar(document.body).stopIndex,
    }));
    return mergeLoads(mergeLoads(cardLoads, tableLoads), detailLoads);
  }

  async function collectVisibleTrips(forcedBucket = null, expandOpts = {}) {
    const base = collectVisibleTripsSync(forcedBucket).map((l) => {
      if (forcedBucket === 'history') {
        return {
          ...l,
          trip_bucket: 'history',
          load_status:
            l.load_status && !/^(Booked|In Transit|Dispatched|Available)$/i.test(l.load_status)
              ? l.load_status
              : 'Completed',
        };
      }
      return l;
    });
    const { loads, expanded, history_skipped } = await enrichLoadsWithAutoExpand(base, {
      ...expandOpts,
      // Only apply History skip-cache on History board
      historySkipMap: forcedBucket === 'history' ? expandOpts.historySkipMap || {} : {},
    });
    return {
      loads,
      expanded,
      history_skipped: history_skipped || 0,
      trip_bucket: forcedBucket || detectTripBucket(),
    };
  }

  function sleep(ms, jitterMs = 0) {
    const extra = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms) + extra));
  }

  function yieldToUi() {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => setTimeout(resolve, 0));
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  /**
   * History is date-grouped; default filter often shows only the current week.
   * Controls we look for:
   * - Buttons / tabs / menuitems / options: "This week", "Last week", "Previous week",
   *   "Last 7 days", "Last 14 days", "Past week", "Prior week"
   * - Combobox / listbox / select labeled Week / Date / Filter / Time period
   * - Native <select> options with the same labels
   * Matching is substring-friendly (Relay often nests label text).
   */
  function findHistoryWeekControls() {
    const labels = [
      { id: 'this_week', re: /\bthis\s*week\b|\bcurrent\s*week\b/i },
      { id: 'last_week', re: /\blast\s*week\b|\bprevious\s*week\b|\bpast\s*week\b|\bprior\s*week\b/i },
      { id: 'last_7_days', re: /\blast\s*7\s*days\b|\bpast\s*7\s*days\b/i },
      { id: 'last_14_days', re: /\blast\s*14\s*days\b|\bpast\s*14\s*days\b|\blast\s*two\s*weeks\b/i },
    ];
    const nodes = [
      ...document.querySelectorAll(
        'button, [role="tab"], [role="menuitem"], [role="option"], [role="radio"], [role="listbox"] *, label, a, select option, [aria-haspopup="listbox"], [data-testid*="week"], [data-testid*="filter"], [class*="filter"], [class*="week"]',
      ),
    ];
    const textOf = (n) =>
      (n.innerText || n.textContent || n.getAttribute?.('aria-label') || n.title || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);

    const found = [];
    for (const label of labels) {
      const el = nodes.find((n) => label.re.test(textOf(n)));
      if (el) {
        found.push({
          id: label.id,
          el: el.tagName === 'OPTION' ? el.parentElement : el,
          option: el.tagName === 'OPTION' ? el : null,
        });
      }
    }
    for (const sel of document.querySelectorAll('select')) {
      const opts = [...sel.options];
      for (const label of labels) {
        const opt = opts.find((o) => label.re.test((o.textContent || '').trim()));
        if (opt && !found.some((f) => f.id === label.id)) {
          found.push({ id: label.id, el: sel, option: opt });
        }
      }
    }
    return found;
  }

  /** Open a Week/Date filter dropdown so options become queryable, then re-scan. */
  async function revealHistoryFilterMenu() {
    const triggers = [
      ...document.querySelectorAll(
        'button, [role="button"], [aria-haspopup="listbox"], [aria-haspopup="menu"], [data-testid*="filter"], [data-testid*="week"], [class*="filter"]',
      ),
    ].filter((el) =>
      /\b(week|date|filter|period|range|time)\b/i.test(
        (el.innerText || el.textContent || el.getAttribute('aria-label') || '').slice(0, 60),
      ),
    );
    for (const el of triggers.slice(0, 3)) {
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        await sleep(350, 120);
      } catch {
        /* ignore */
      }
    }
  }

  async function applyHistoryWeekControl(control) {
    if (!control?.el) return false;
    try {
      if (control.option && control.el.tagName === 'SELECT') {
        control.el.value = control.option.value;
        control.el.dispatchEvent(new Event('change', { bubbles: true }));
        control.el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      control.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch {
      try {
        control.el.click();
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * On History: cover at least prior week + current week via filter controls.
   * Returns { loads, weeks, expanded }.
   */
  async function collectHistoryWithWeekFilters(expandOpts = {}) {
    const settle = expandOpts.historyWeekSettleMs ?? 1400;
    const jitter = expandOpts.tabSwitchJitterMs ?? 500;
    const scrapedMap = expandOpts.scrapedMap || (await getDetailScrapedMap());
    let remainingExpand = expandOpts.maxExpand ?? 8;
    let rowsExpanded = 0;
    let merged = [];
    const weeks = [];

    let controls = findHistoryWeekControls();
    if (!controls.length) {
      await revealHistoryFilterMenu();
      controls = findHistoryWeekControls();
    }
    const last14 = controls.find((c) => c.id === 'last_14_days');
    const thisWeek = controls.find((c) => c.id === 'this_week' || c.id === 'last_7_days');
    const lastWeek = controls.find((c) => c.id === 'last_week');

    const plan = [];
    if (last14) {
      plan.push(last14);
    } else {
      if (thisWeek) plan.push(thisWeek);
      if (lastWeek) plan.push(lastWeek);
      // Prefer both weeks when last_7 is present without last_week — still scrape visible + last_7
      if (!plan.length && controls.length) {
        plan.push(controls[0]);
      }
    }
    let historySkipped = 0;

    // Always scrape whatever is visible once; then re-scrape after each filter change
    if (!plan.length) {
      const result = await collectVisibleTrips('history', {
        ...expandOpts,
        maxExpand: remainingExpand,
        scrapedMap,
      });
      weeks.push('visible_default');
      historySkipped += result.history_skipped || 0;
      return {
        loads: result.loads
          .filter((l) => !l.history_skip)
          .map((l) => ({
            ...l,
            trip_bucket: 'history',
            load_status: l.load_status || 'Completed',
            history_week: 'visible_default',
          })),
        weeks,
        expanded: result.expanded || 0,
        history_skipped: historySkipped,
        filters_found: controls.map((c) => c.id),
      };
    }

    for (const control of plan) {
      await applyHistoryWeekControl(control);
      await sleep(settle, jitter);
      await yieldToUi();
      const result = await collectVisibleTrips('history', {
        ...expandOpts,
        maxExpand: remainingExpand,
        scrapedMap,
      });
      historySkipped += result.history_skipped || 0;
      const tagged = result.loads
        .filter((l) => !l.history_skip)
        .map((l) => ({
          ...l,
          trip_bucket: 'history',
          load_status: l.load_status || 'Completed',
          history_week: control.id,
        }));
      remainingExpand = Math.max(0, remainingExpand - (result.expanded || 0));
      rowsExpanded += result.expanded || 0;
      weeks.push(control.id);
      merged = mergeLoads(merged, tagged);
      for (const load of tagged) {
        if (!detailIsRich(load)) continue;
        scrapedMap[load.load_id] = {
          at: Date.now(),
          hasTrailer: Boolean(load.trailer_id),
          hasTractor: Boolean(load.tractor_id),
        };
      }
    }

    // Restore current/this week so the user is not left on last week
    if (thisWeek && plan.some((p) => p.id === 'last_week')) {
      await applyHistoryWeekControl(thisWeek);
      await sleep(400, 120);
    }

    return {
      loads: merged,
      weeks,
      expanded: rowsExpanded,
      history_skipped: historySkipped,
      filters_found: controls.map((c) => c.id),
    };
  }

  /**
   * Prefer one Chrome tab: click Upcoming / In Transit / History in-page if Relay
   * loads list data on tab click. Falls back to current tab only when tabs missing.
   * History also walks week filters (prior + current). Soft yields between steps.
   */
  async function collectAllTripBuckets(expandOpts = {}) {
    const maxExpand = expandOpts.maxExpand ?? 8;
    const scrapedMap = expandOpts.scrapedMap || (await getDetailScrapedMap());
    const tabDelay = expandOpts.tabSwitchDelayMs ?? 1100;
    const tabJitter = expandOpts.tabSwitchJitterMs ?? 500;
    const doHistoryWeeks = expandOpts.historyWeeks !== false;
    const tabs = findTripTabButtons();
    if (tabs.length < 2) {
      const bucket = detectTripBucket();
      if (bucket === 'history' && doHistoryWeeks) {
        const hist = await collectHistoryWithWeekFilters({
          ...expandOpts,
          maxExpand,
          scrapedMap,
        });
        return {
          loads: hist.loads,
          trip_buckets_scanned: ['history'],
          history_weeks_scanned: hist.weeks,
          history_filters_found: hist.filters_found,
          history_skipped: hist.history_skipped || 0,
          auto_tab_switch: false,
          rows_expanded: hist.expanded,
        };
      }
      const result = await collectVisibleTrips(null, { ...expandOpts, maxExpand, scrapedMap });
      return {
        loads: result.loads,
        trip_buckets_scanned: [bucket].filter(Boolean),
        history_weeks_scanned: [],
        auto_tab_switch: false,
        rows_expanded: result.expanded,
      };
    }

    const activeBefore = detectTripBucket();
    const activeEl =
      tabs.find((t) => t.bucket === activeBefore)?.el ||
      tabs.find((t) => t.el.getAttribute('aria-selected') === 'true')?.el ||
      null;

    let merged = [];
    const scanned = [];
    let remainingExpand = maxExpand;
    let rowsExpanded = 0;
    let historyWeeks = [];
    let historyFilters = [];
    let historySkipped = 0;

    for (const tab of tabs) {
      try {
        tab.el.click();
        await sleep(tabDelay, tabJitter);
        await yieldToUi();
      } catch {
        /* continue with whatever is visible */
      }

      if (tab.bucket === 'history' && doHistoryWeeks) {
        const hist = await collectHistoryWithWeekFilters({
          ...expandOpts,
          maxExpand: remainingExpand,
          scrapedMap,
        });
        remainingExpand = Math.max(0, remainingExpand - (hist.expanded || 0));
        rowsExpanded += hist.expanded || 0;
        scanned.push(tab.bucket);
        historyWeeks = hist.weeks;
        historyFilters = hist.filters_found || [];
        historySkipped += hist.history_skipped || 0;
        merged = mergeLoads(merged, hist.loads);
        continue;
      }

      const result = await collectVisibleTrips(tab.bucket, {
        ...expandOpts,
        maxExpand: remainingExpand,
        scrapedMap,
      });
      const loads = result.loads.map((l) => ({
        ...l,
        trip_bucket: tab.bucket,
      }));
      remainingExpand = Math.max(0, remainingExpand - (result.expanded || 0));
      rowsExpanded += result.expanded || 0;
      scanned.push(tab.bucket);
      merged = mergeLoads(merged, loads);
      for (const load of loads) {
        if (!detailIsRich(load)) continue;
        scrapedMap[load.load_id] = {
          at: Date.now(),
          hasTrailer: Boolean(load.trailer_id),
          hasTractor: Boolean(load.tractor_id),
        };
      }
    }

    if (activeEl) {
      try {
        activeEl.click();
        await sleep(400, 120);
      } catch {
        /* ignore restore errors */
      }
    }

    return {
      loads: merged,
      trip_buckets_scanned: scanned,
      history_weeks_scanned: historyWeeks,
      history_filters_found: historyFilters,
      history_skipped: historySkipped,
      auto_tab_switch: true,
      rows_expanded: rowsExpanded,
    };
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

    // Sync path: current visible Trips tab only (fast, no expand) — expand runs on RELAY_COLLECT allTripTabs
    if (section === 'tours') {
      const loads = collectVisibleTripsSync();
      return {
        section: 'tours',
        loads,
        trip_bucket: detectTripBucket(),
        detail_detected: loads.some((l) => l.trailer_id || l.tractor_id),
        payments: [],
        pageTitle: document.title,
        url: location.href,
      };
    }

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
      (async () => {
        window.__internalSysCollectBusy = true;
        try {
          if (msg?.skipIfHidden !== false && document.hidden) {
            sendResponse({ ok: false, skippedHidden: true, error: 'Tab hidden — soft skip' });
            return;
          }

          let section = detectSection();
          // Hard override: Trips board UI / URL must never stay stuck as load_detail
          if (section !== 'payments' && (isTripsBoardUrl() || isTripsBoardDom())) {
            section = 'tours';
          }

          const expandOpts = {
            maxExpand: msg?.maxExpand ?? 8,
            expandDelayMs: msg?.expandDelayMs ?? 700,
            collapseDelayMs: msg?.collapseDelayMs ?? 280,
            expandJitterMs: msg?.expandJitterMs ?? 350,
            tabSwitchDelayMs: msg?.tabSwitchDelayMs ?? 1100,
            tabSwitchJitterMs: msg?.tabSwitchJitterMs ?? 500,
            historyWeekSettleMs: msg?.historyWeekSettleMs ?? 1400,
            historyWeeks: msg?.historyWeeks !== false,
            softYield: msg?.softYield !== false,
            historySkipMap: msg?.historySkipMap || {},
          };

          if (section === 'tours' && msg?.allTripTabs !== false) {
            const multi = await collectAllTripBuckets(expandOpts);
            sendResponse({
              ok: true,
              data: {
                section: 'tours',
                loads: multi.loads,
                trip_bucket: detectTripBucket(),
                trip_buckets_scanned: multi.trip_buckets_scanned,
                history_weeks_scanned: multi.history_weeks_scanned || [],
                history_filters_found: multi.history_filters_found || [],
                history_skipped: multi.history_skipped || 0,
                auto_tab_switch: multi.auto_tab_switch,
                rows_expanded: multi.rows_expanded || 0,
                detail_detected: multi.loads.some((l) => l.trailer_id || l.tractor_id),
                payments: [],
                pageTitle: document.title,
                url: location.href,
              },
            });
            return;
          }
          // Even on sync single-tab path, force board scrape when mislabeled
          if (section === 'load_detail' && (isTripsBoardUrl() || isTripsBoardDom())) {
            const result = await collectVisibleTrips(null, expandOpts);
            sendResponse({
              ok: true,
              data: {
                section: 'tours',
                loads: result.loads,
                trip_bucket: detectTripBucket(),
                rows_expanded: result.expanded || 0,
                detail_detected: result.loads.some((l) => l.trailer_id || l.tractor_id),
                payments: [],
                pageTitle: document.title,
                url: location.href,
              },
            });
            return;
          }
          sendResponse({ ok: true, data: collect() });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        } finally {
          window.__internalSysCollectBusy = false;
        }
      })();
      return true;
    }
    if (msg?.type === 'RELAY_PING') {
      sendResponse({
        ok: true,
        section: detectSection(),
        trip_bucket: detectTripBucket(),
        trips_board: isTripsBoardUrl() || isTripsBoardDom(),
        url: location.href,
      });
      return true;
    }
    return false;
  });

  /**
   * Near-live Trips watcher (Upcoming + In Transit only).
   * MutationObserver + light fetch/XHR hooks → debounced incremental scrape.
   * Skips History, Payments, hidden tabs, and while a full RELAY_COLLECT runs.
   */
  function setupNearLiveWatcher() {
    if (window.__internalSysNearLive) return;
    window.__internalSysNearLive = true;

    let debounceTimer = null;
    let lastSentAt = 0;
    let lastFingerprint = '';
    const DEBOUNCE_BASE = 2800;
    const DEBOUNCE_JITTER = 1800;
    const MIN_INTERVAL = 8000;

    function liveBucketOk() {
      const bucket = detectTripBucket();
      return bucket === 'upcoming' || bucket === 'in_transit';
    }

    function shouldWatch() {
      if (document.hidden) return false;
      if (window.__internalSysCollectBusy) return false;
      if (/payment|settlement|invoice/i.test(location.href)) return false;
      if (!(isTripsBoardUrl() || isTripsBoardDom())) return false;
      return liveBucketOk();
    }

    function fingerprintLoads(loads) {
      return loads
        .map(
          (l) =>
            `${l.load_id}|${l.status || ''}|${l.status_bar_state || ''}|${l.driver_name || ''}|${l.trailer_id || ''}`,
        )
        .sort()
        .join(';');
    }

    function schedule(reason) {
      if (!shouldWatch()) return;
      clearTimeout(debounceTimer);
      const wait = DEBOUNCE_BASE + Math.floor(Math.random() * DEBOUNCE_JITTER);
      debounceTimer = setTimeout(() => {
        void runIncremental(reason || 'dom');
      }, wait);
    }

    async function runIncremental(reason) {
      try {
        if (!shouldWatch()) return;
        const now = Date.now();
        if (now - lastSentAt < MIN_INTERVAL) return;

        const bucket = detectTripBucket();
        const loads = collectVisibleTripsSync(bucket);
        if (!loads.length) return;
        const fp = fingerprintLoads(loads);
        if (fp === lastFingerprint) return;

        lastFingerprint = fp;
        lastSentAt = now;
        chrome.runtime.sendMessage({
          type: 'NEAR_LIVE_TRIPS',
          loads,
          trip_bucket: bucket,
          url: location.href,
          hidden: document.hidden,
          reason,
        });
      } catch {
        /* non-fatal */
      }
    }

    const mo = new MutationObserver(() => schedule('mutation'));
    const startMo = () => {
      if (!document.body) return;
      try {
        mo.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      } catch {
        /* ignore */
      }
    };
    if (document.body) startMo();
    else document.addEventListener('DOMContentLoaded', startMo, { once: true });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) schedule('visible');
    });

    // Light network hooks — schedule only, never read bodies
    try {
      const origFetch = window.fetch;
      if (typeof origFetch === 'function' && !origFetch.__internalSysWrapped) {
        const wrapped = async function (...args) {
          const res = await origFetch.apply(this, args);
          try {
            const u = String(args[0]?.url || args[0] || '');
            if (/trip|tour|load|relay|work|schedule/i.test(u)) schedule('fetch');
          } catch {
            /* ignore */
          }
          return res;
        };
        wrapped.__internalSysWrapped = true;
        window.fetch = wrapped;
      }
    } catch {
      /* ignore */
    }

    try {
      const XO = XMLHttpRequest.prototype.open;
      const XS = XMLHttpRequest.prototype.send;
      if (!XO.__internalSysWrapped) {
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
          this.__internalSysUrl = url;
          return XO.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.open.__internalSysWrapped = true;
        XMLHttpRequest.prototype.send = function (...args) {
          this.addEventListener('loadend', () => {
            try {
              if (/trip|tour|load|relay|work|schedule/i.test(String(this.__internalSysUrl || ''))) {
                schedule('xhr');
              }
            } catch {
              /* ignore */
            }
          });
          return XS.apply(this, args);
        };
      }
    } catch {
      /* ignore */
    }

    // Initial pass shortly after inject when already on live board
    setTimeout(() => schedule('init'), 2000 + Math.floor(Math.random() * 1000));
  }

  setupNearLiveWatcher();
})();
