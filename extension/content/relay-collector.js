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

  const STATE_ABBREV = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
    colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
    hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
    kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
    michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
    nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
    'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
    ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
    'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
    utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
    wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
  };

  function titleCaseCity(city) {
    return String(city)
      .toLowerCase()
      .replace(/\b[a-z]/g, (c) => c.toUpperCase())
      .replace(/\b(Of|And|The)\b/g, (w) => w.toLowerCase());
  }

  function cleanLoc(s) {
    const cleaned = String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*.*$/i, '')
      .replace(/\s*\$[\d,.]+.*$/i, '')
      .replace(/\b\d[\d,.]*\s*mi\b.*$/i, '')
      .trim()
      .slice(0, 120);
    if (!cleaned || /^\$/.test(cleaned) || /\$\s*[\d,]/.test(cleaned)) return null;
    if (/^\/?Live$/i.test(cleaned)) return null;
    if (/^\d[\d,]*\.?\d*\s*$/.test(cleaned)) return null;
    if (/^unknown\b/i.test(cleaned)) return null;
    if (/^(Drop|Pickup|PU|Del|Spot|Vendor)$/i.test(cleaned)) return null;
    if (/^[,.]/.test(cleaned) || /^[a-z]/.test(cleaned)) return null; // truncated scrap
    if (/^Sch\./i.test(cleaned)) return null;
    if (cleaned.length < 3) return null;
    return cleaned;
  }

  function placeFromAddressLine(raw) {
    if (!raw) return null;
    const s = String(raw).replace(/\s+/g, ' ').trim();
    if (!s || s.length > 220) return null;

    let m = s.match(
      /,\s*([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Z]{2}|[A-Za-z][A-Za-z ]{2,20})\s+\d{5}(?:-\d{4})?\b/,
    );
    if (m) {
      const city = m[1].replace(/\s+/g, ' ').trim();
      const stRaw = m[2].trim();
      const st = stRaw.length === 2 ? stRaw.toUpperCase() : STATE_ABBREV[stRaw.toLowerCase()];
      if (city && st && !/^(street|avenue|drive|road|way|blvd|lane|dr|ave|rd)$/i.test(city)) {
        return cleanLoc(`${titleCaseCity(city)}, ${st}`);
      }
    }

    m = s.match(
      /\b(?:[A-Z]{2,4}\d{1,2}[A-Z0-9]?|MARS[A-Z0-9_]*)\s+([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Z]{2})\s*(?:\d{5})?\b/,
    );
    if (m) return cleanLoc(`${titleCaseCity(m[1])}, ${m[2].toUpperCase()}`);

    m = s.match(/\b([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Z]{2})\b(?!\s*[A-Za-z])/);
    if (m && m[1].length >= 3) {
      return cleanLoc(`${titleCaseCity(m[1])}, ${m[2].toUpperCase()}`);
    }
    return null;
  }

  function isGoodLocation(raw) {
    return Boolean(cleanLoc(raw) || placeFromAddressLine(raw));
  }

  /**
   * Prefer expanded stop addresses (city/state); then facility+city tooltips;
   * then facility codes. Never keep money / truncated scraps.
   */
  function parsePlacesFromBlock(block) {
    const text = String(block || '');
    const addressPlaces = [];
    const addrRe =
      /\d{1,6}\s+[A-Za-z0-9][A-Za-z0-9 .'-]{2,60},\s*[A-Za-z][A-Za-z .'-]{1,40},\s*(?:[A-Z]{2}|[A-Za-z][A-Za-z ]{2,20})\s+\d{5}/g;
    for (const hit of text.match(addrRe) || []) {
      const place = placeFromAddressLine(hit);
      if (place) addressPlaces.push(place);
    }

    // Stop N FAC… lines with city on same/next fragment
    const stopCityRe =
      /\b(?:Stop\s*)?\d+\s+([A-Z]{2,4}\d{1,2}[A-Z0-9]?|MARS[A-Z0-9_]*)\b[^\n]{0,80}?([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Z]{2}|California|Nevada|Texas|Arizona|Washington|Oregon|Utah|Colorado|Illinois)\b/gi;
    const stopPlaces = [];
    for (const m of text.matchAll(stopCityRe)) {
      const stRaw = m[3];
      const st = stRaw.length === 2 ? stRaw.toUpperCase() : STATE_ABBREV[stRaw.toLowerCase()];
      const place = cleanLoc(st ? `${titleCaseCity(m[2])}, ${st}` : null);
      if (place) stopPlaces.push(place);
    }

    const tooltipPlaces = [];
    const tipRe =
      /\b([A-Z]{2,4}\d{1,2}[A-Z0-9]?|MARS[A-Z0-9_]*)\s+([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Z]{2})\s*\d{5}/g;
    for (const m of text.matchAll(tipRe)) {
      const place = cleanLoc(`${titleCaseCity(m[2])}, ${m[3].toUpperCase()}`);
      if (place) tooltipPlaces.push(place);
    }

    const labeledPickup =
      placeFromAddressLine(extractLabeledValue(text, ['Pickup location', 'Origin', 'From'])) ||
      cleanLoc(extractLabeledValue(text, ['Pickup location', 'Origin', 'From']));
    const labeledDelivery =
      placeFromAddressLine(extractLabeledValue(text, ['Delivery location', 'Destination', 'Dropoff', 'Drop-off', 'To'])) ||
      cleanLoc(extractLabeledValue(text, ['Delivery location', 'Destination', 'Dropoff', 'Drop-off', 'To']));

    // Facility codes only (APC2 → SBD3) — last resort, better than Unknown
    const facilityArrow = text.match(
      /\b([A-Z]{2,4}\d{1,2}[A-Z0-9]?|MARS[A-Z0-9_]{3,})\b[^\n]{0,40}?(?:→|->|–|—)\s*\b([A-Z]{2,4}\d{1,2}[A-Z0-9]?|MARS[A-Z0-9_]{3,})\b/,
    );

    // Route arrow with city fragments — do NOT use bare "-" (matches "Drop - $pay")
    const routeArrow = text.match(
      /([A-Z0-9_]{3,}[^\n→—–]{0,50}?)\s*(?:→|->|–|—)\s*([A-Z0-9_]{3,}[^\n]{0,50})/i,
    );
    let arrowPickup = null;
    let arrowDelivery = null;
    if (routeArrow) {
      arrowPickup =
        placeFromAddressLine(routeArrow[1]) ||
        cleanLoc(
          String(routeArrow[1])
            .replace(/^\d+\s+/, '')
            .replace(/\b(?:[A-Z]{2,4}\d{1,2}[A-Z0-9]?|MARS[A-Z0-9_]*)\s+/i, '')
            .replace(/\.{2,}.*/, '')
            .trim(),
        );
      arrowDelivery =
        placeFromAddressLine(routeArrow[2]) ||
        cleanLoc(
          String(routeArrow[2])
            .replace(/^\d+\s+/, '')
            .replace(/\b(?:[A-Z]{2,4}\d{1,2}[A-Z0-9]?|MARS[A-Z0-9_]*)\s+/i, '')
            .replace(/\.{2,}.*/, '')
            .trim(),
        );
      // Reject if still looks like a facility-only code without city — keep code as place
      if (!arrowPickup && facilityArrow) arrowPickup = cleanLoc(facilityArrow[1]);
      if (!arrowDelivery && facilityArrow) arrowDelivery = cleanLoc(facilityArrow[2]);
    }

    const orderedPickup = [
      addressPlaces[0],
      stopPlaces[0],
      tooltipPlaces[0],
      labeledPickup,
      arrowPickup,
      facilityArrow ? cleanLoc(facilityArrow[1]) : null,
    ].find((x) => isGoodLocation(x));

    const orderedDelivery = [
      addressPlaces[1] || (addressPlaces.length === 1 ? null : addressPlaces[addressPlaces.length - 1]),
      stopPlaces[1] || (stopPlaces.length > 1 ? stopPlaces[stopPlaces.length - 1] : null),
      tooltipPlaces[1] || (tooltipPlaces.length > 1 ? tooltipPlaces[tooltipPlaces.length - 1] : null),
      labeledDelivery,
      arrowDelivery,
      facilityArrow ? cleanLoc(facilityArrow[2]) : null,
    ].find((x) => isGoodLocation(x));

    // If only one address found, don't invent the other from it
    return {
      pickup_location: orderedPickup || null,
      delivery_location: orderedDelivery || null,
    };
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

  /**
   * Relay Arrival section (actual vs Sch.) — used for facility-arrival Telegram alerts.
   * Example:
   *   Arrival
   *   15 Nov, 13:45 PST   Y+
   *   Sch. 15 Nov, 14:45 PST
   */
  function scrapeArrivalSection(text) {
    const src = String(text || '');
    if (!/\bArrival\b/i.test(src)) {
      return { arrival_actual: null, arrival_scheduled: null, arrival_address: null };
    }

    const timeRe =
      /(\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{1,2}:\d{2}\s*(?:PST|PDT|EST|EDT|CST|CDT|MST|MDT)?|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+[A-Za-z]+\s+\d{1,2}(?:,?\s*\d{4})?(?:\s*,?\s*\d{1,2}:\d{2}\s*(?:PST|PDT|EST|EDT|CST|CDT|MST|MDT)?)?)/i;

    let arrival_actual = null;
    let arrival_scheduled = null;

    const block =
      (src.match(
        /Arrival\s*[\r\n]+([\s\S]{0,280}?)(?:Report delay|Departure|Trailer|Tractor|Stop\s*\d|$)/i,
      ) || [])[1] || '';
    const schLine = (block.match(/Sch\.?\s*([^\r\n]+)/i) || src.match(/Sch\.?\s*([^\r\n]+)/i) || [])[1];
    if (schLine) {
      const schHit = schLine.match(timeRe);
      arrival_scheduled = (schHit ? schHit[1] : schLine).replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    const actualLine = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !/^Sch\.?/i.test(l) && !/^Arrival$/i.test(l) && !/^Report/i.test(l));
    if (actualLine) {
      const actHit = actualLine.replace(/\bY\+?\b/g, '').match(timeRe);
      if (actHit) arrival_actual = actHit[1].replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    if (!arrival_actual) {
      const inline = src.match(
        /Arrival\s+([^\n]{0,80}?\d{1,2}:\d{2}\s*(?:PST|PDT|EST|EDT|CST|CDT|MST|MDT)?)/i,
      );
      if (inline) arrival_actual = inline[1].replace(/\bY\+?\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    }

    // Prefer a street-like address near Arrival / current stop
    let arrival_address = null;
    const addrHit = src.match(
      /(\d{1,6}\s+[A-Za-z0-9][A-Za-z0-9 .'#-]{3,60},\s*[A-Za-z .'-]+,\s*(?:[A-Z]{2}|[A-Za-z]{4,})\s+\d{5}(?:-\d{4})?)/,
    );
    if (addrHit) arrival_address = addrHit[1].replace(/\s+/g, ' ').trim().slice(0, 160);

    return { arrival_actual, arrival_scheduled, arrival_address };
  }

  function applyArrivalFields(target, text) {
    if (!target) return target;
    const arr = scrapeArrivalSection(text);
    if (arr.arrival_actual) target.arrival_actual = arr.arrival_actual;
    if (arr.arrival_scheduled) target.arrival_scheduled = arr.arrival_scheduled;
    if (arr.arrival_address) target.arrival_address = arr.arrival_address;
    return target;
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

    const places = parsePlacesFromBlock(block);

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

    const arrival = scrapeArrivalSection(block);
    return {
      load_id: String(loadId).trim(),
      amazon_ref_id: legId && legId !== String(loadId) ? legId : tripId || legId || null,
      parent_trip_id: parentTripId && String(loadId).toUpperCase() !== parentTripId ? parentTripId : parentTripId,
      load_status: status,
      payment_status: null,
      pickup_location: places.pickup_location,
      delivery_location: places.delivery_location,
      pickup_date: pickupDate,
      delivery_date: deliveryDate,
      trailer_id: normalizeTrailer(trailerRaw),
      tractor_id: tractorRaw ? String(tractorRaw).replace(/\s+/g, ' ').trim().slice(0, 40) : null,
      trailer_type: equipment,
      job_type: jobType,
      trip_bucket: tripBucket,
      status_bar_state: statusBar.state,
      status_stop_index: statusBar.stopIndex,
      arrival_actual: arrival.arrival_actual,
      arrival_scheduled: arrival.arrival_scheduled,
      arrival_address: arrival.arrival_address,
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
          pickup_location:
            pickupIdx >= 0
              ? placeFromAddressLine(cells[pickupIdx]) || cleanLoc(cells[pickupIdx])
              : null,
          delivery_location:
            deliveryIdx >= 0
              ? placeFromAddressLine(cells[deliveryIdx]) || cleanLoc(cells[deliveryIdx])
              : null,
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

  function locationsAreGood(load) {
    return isGoodLocation(load?.pickup_location) && isGoodLocation(load?.delivery_location);
  }

  function arrivalIsRich(load) {
    return Boolean(load?.arrival_actual || load?.arrival_scheduled);
  }

  /** Expand when equipment, places, or Arrival section fields are missing. */
  function needsExpand(load) {
    const needsArrival =
      (load?.trip_bucket === 'in_transit' || load?.status_bar_state === 'arrived') &&
      !arrivalIsRich(load);
    return !detailIsRich(load) || !locationsAreGood(load) || needsArrival;
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
    if (isCardExpanded(cardRoot)) return null;
    const selectors = [
      'button[aria-expanded="false"]',
      '[aria-expanded="false"]',
      'button[aria-label*="expand" i]',
      'button[aria-label*="collapse" i]',
      'button[aria-label*="detail" i]',
      'button[aria-label*="chevron" i]',
      '[data-testid*="expand" i]',
      '[class*="chevron" i]',
      '[class*="Expand" i]',
      '[class*="Caret" i]',
    ];
    for (const sel of selectors) {
      try {
        const el = cardRoot.querySelector(sel);
        if (el) return el.closest('button, [role="button"], a') || el;
      } catch {
        /* invalid selector in older Chromium — skip */
      }
    }
    // Leg-row chevron: first small icon button near a load/trip id
    const buttons = [...cardRoot.querySelectorAll('button, [role="button"], [tabindex="0"]')].filter(
      (b) => {
        const label = `${b.getAttribute('aria-label') || ''} ${b.className || ''} ${b.getAttribute('title') || ''}`;
        if (/expand|chevron|caret|detail|toggle|arrow|collapse/i.test(label)) return true;
        if (b.getAttribute('aria-expanded') === 'false') return true;
        const svg = b.querySelector('svg');
        if (!svg) return false;
        const r = b.getBoundingClientRect?.();
        return !r || (r.width > 0 && r.width <= 48 && r.height <= 48);
      },
    );
    return buttons[0] || null;
  }

  function isCardExpanded(cardRoot) {
    if (!cardRoot) return false;
    if (cardRoot.querySelector('[aria-expanded="true"]')) return true;
    const t = cardRoot.innerText || '';
    if (/\bTrailer\b/i.test(t) && /\bTractor\b/i.test(t)) return true;
    // Expanded stop table: street address + Arrival/Departure columns
    if (
      /\bArrival\b/i.test(t) &&
      /\bDeparture\b/i.test(t) &&
      /\d{1,6}\s+[A-Za-z].+,\s*[A-Za-z].+,\s*(?:[A-Z]{2}|[A-Za-z]{4,})\s+\d{5}/.test(t)
    ) {
      return true;
    }
    return false;
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
    const needle = String(loadId).trim().toUpperCase();
    const anchors = [...document.querySelectorAll('a, button, [role="link"], span, div')].filter(
      (el) => (el.innerText || el.textContent || '').trim().toUpperCase() === needle,
    );
    for (const el of anchors) {
      let node = el;
      for (let i = 0; i < 10 && node; i += 1) {
        const text = (node.innerText || '').trim();
        if (
          text.length > 60 &&
          /mi\b|\$|→|->|–|driver|payout|spot|trailer|equipment|arrival|departure/i.test(text)
        ) {
          return node;
        }
        node = node.parentElement;
      }
      const fallback = el.closest('[class], section, article, li, tr, [role="row"]') || el;
      if (fallback) return fallback;
    }
    return null;
  }

  function findCardRootForLoad(load) {
    return (
      findCardRootForLoadId(load?.amazon_ref_id) ||
      findCardRootForLoadId(load?.load_id) ||
      findCardRootForLoadId(load?.parent_trip_id)
    );
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
    applyArrivalFields(parsed, block);
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

  function mergeParsedOntoLoad(load, parsed) {
    if (!parsed) return load;
    const next = {
      ...load,
      ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v != null && v !== '')),
    };
    // Prefer newly parsed good places over prior Unknown / money scraps
    if (isGoodLocation(parsed.pickup_location)) next.pickup_location = parsed.pickup_location;
    if (isGoodLocation(parsed.delivery_location)) next.delivery_location = parsed.delivery_location;
    if (!isGoodLocation(next.pickup_location)) next.pickup_location = null;
    if (!isGoodLocation(next.delivery_location)) next.delivery_location = null;
    return next;
  }

  /**
   * DOM/React first; click-expand when Trailer/Tractor or city/state places missing.
   * Rate-limited; collapses after scrape. Skips IDs already in chrome.storage when rich.
   */
  async function expandAndEnrichLoad(load, opts = {}) {
    const {
      expandDelayMs = 700,
      collapseDelayMs = 280,
      expandJitterMs = 350,
      allowExpand = true,
      softYield = true,
    } = opts;

    if (
      detailIsRich(load) &&
      locationsAreGood(load) &&
      load.notes &&
      /Late:|Stops:/.test(load.notes)
    ) {
      return { load, method: 'already_rich', expanded: false };
    }

    const cardRoot = findCardRootForLoad(load);
    if (!cardRoot) {
      return { load, method: 'no_card', expanded: false };
    }

    let enriched = parseDetailFromCard(cardRoot, load.trip_bucket, load.section || 'tours');
    load = mergeParsedOntoLoad(load, enriched);

    if (!needsExpand(load) || (isCardExpanded(cardRoot) && locationsAreGood(load) && detailIsRich(load))) {
      load.detail_method =
        load.detail_method || (detailIsRich(load) && locationsAreGood(load) ? 'dom' : 'open_partial');
      return { load, method: load.detail_method, expanded: false };
    }

    if (isCardExpanded(cardRoot)) {
      enriched = parseDetailFromCard(cardRoot, load.trip_bucket, load.section || 'tours');
      load = mergeParsedOntoLoad(load, enriched);
      if (!needsExpand(load)) {
        load.detail_method = load.detail_method || 'dom_expanded';
        return { load, method: load.detail_method, expanded: false };
      }
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

    // Detail often mounts on the card or next sibling panel (leg dropdown under trip)
    const scopes = [
      cardRoot,
      cardRoot.nextElementSibling,
      cardRoot.parentElement,
      cardRoot.parentElement?.nextElementSibling,
    ].filter(Boolean);
    for (const scope of scopes) {
      const parsed = parseDetailFromCard(scope, load.trip_bucket, load.section || 'tours');
      if (!parsed) continue;
      load = mergeParsedOntoLoad(load, parsed);
      if (detailIsRich(load) && locationsAreGood(load)) break;
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
      const cachedEquip = Boolean(prior?.hasTrailer || prior?.hasTractor);
      // Still expand when places are Unknown/money even if equipment was cached
      const skipExpand =
        (cachedEquip && locationsAreGood(raw)) || Boolean(histSkip?.skipExpand);
      const allowExpand = !skipExpand && expandCount < maxExpand && needsExpand(raw);
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
      if (!isGoodLocation(load.pickup_location)) load.pickup_location = null;
      if (!isGoodLocation(load.delivery_location)) load.delivery_location = null;
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
    applyArrivalFields(parsed, block);
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
        ...(() => {
          const places = parsePlacesFromBlock(text);
          return {
            pickup_location: places.pickup_location,
            delivery_location: places.delivery_location,
          };
        })(),
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
      const next = {
        ...prev,
        ...Object.fromEntries(Object.entries(load).filter(([, v]) => v != null && v !== '')),
      };
      // Prefer Upcoming/In Transit over History when the same id is seen on both boards
      // (failed tab switch can re-tag active cards as history).
      const prevBucket = prev.trip_bucket;
      const nextBucket = load.trip_bucket;
      if (
        (prevBucket === 'upcoming' || prevBucket === 'in_transit') &&
        nextBucket === 'history'
      ) {
        next.trip_bucket = prevBucket;
        if (prev.load_status) next.load_status = prev.load_status;
      }
      map.set(load.load_id, next);
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
            `${l.load_id}|${l.load_status || ''}|${l.status_bar_state || ''}|${l.driver_name_raw || ''}|${l.trailer_id || ''}|${l.pickup_location || ''}|${l.delivery_location || ''}`,
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
        // Expand changed rows so PU/drop city-state + trailer/load id are visible
        const result = await collectVisibleTrips(bucket, {
          maxExpand: 3,
          expandDelayMs: 700,
          collapseDelayMs: 280,
          expandJitterMs: 350,
          softYield: true,
        });
        const loads = (result.loads || []).filter((l) => !l.history_skip);
        if (!loads.length) return;
        const fp = fingerprintLoads(loads);
        if (fp === lastFingerprint && !loads.some((l) => !locationsAreGood(l))) return;

        lastFingerprint = fp;
        lastSentAt = now;
        chrome.runtime.sendMessage({
          type: 'NEAR_LIVE_TRIPS',
          loads,
          trip_bucket: bucket,
          rows_expanded: result.expanded || 0,
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
