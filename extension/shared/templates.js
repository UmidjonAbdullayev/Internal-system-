/**
 * Per-tab entitiesV2 request templates + window / now-timestamp helpers.
 * Fallbacks from live DevTools capture (HISTORY + UPCOMING only).
 * Never derive IN_TRANSIT from another tab.
 */

export const FALLBACK_CAPTURED_AT = {
  HISTORY: '2026-11-17T14:14:46.351Z',
  UPCOMING: '2026-11-17T14:17:55.703Z',
};

/** Built-in fallback bodies — exact captured shapes (tileCountTab preserved). */
export const FALLBACK_BODIES = {
  HISTORY: {
    filter: [
      {
        query: [
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 1,
            type: 1,
            value: ['DRAFT'],
          },
          {
            field: 'dynamicSearchFields.keywords',
            operation: 1,
            type: 1,
            value: ['IGNORE_FOR_TRIP'],
          },
          {
            field: 'effectiveStart',
            operation: 0,
            type: 3,
            lte: '2026-11-21T18:59:59.999Z',
          },
          {
            field: 'effectiveEnd',
            operation: 0,
            type: 3,
            gte: '2026-11-14T19:00:00.000Z',
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 0,
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 1,
            value: ['REJECTED', 'CANCELLED'],
          },
        ],
        modules: [{ moduleType: 'trip', viewTypes: ['tour', 'tourTerminal'] }],
        loadTypeFilters: ['All'],
      },
      {
        query: [
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 1,
            type: 1,
            value: ['DRAFT'],
          },
          {
            field: 'dynamicSearchFields.keywords',
            operation: 1,
            type: 1,
            value: ['IGNORE_FOR_TRIP'],
          },
          {
            field: 'effectiveStart',
            operation: 0,
            type: 3,
            lte: '2026-11-21T18:59:59.999Z',
          },
          {
            field: 'effectiveEnd',
            operation: 0,
            type: 3,
            gte: '2026-11-14T19:00:00.000Z',
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 0,
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 1,
            value: ['COMPLETED'],
          },
          {
            field: 'dynamicSearchFields.blockEffectiveEnd',
            operation: 0,
            type: 3,
            lte: '2026-11-17T14:14:46.351Z',
          },
        ],
        modules: [{ moduleType: 'trip', viewTypes: ['tour', 'tourTerminal'] }],
        loadTypeFilters: ['All'],
      },
      {
        query: [
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 1,
            type: 1,
            value: ['DRAFT'],
          },
          {
            field: 'dynamicSearchFields.keywords',
            operation: 1,
            type: 1,
            value: ['IGNORE_FOR_TRIP'],
          },
          {
            field: 'effectiveStart',
            operation: 0,
            type: 3,
            lte: '2026-11-21T18:59:59.999Z',
          },
          {
            field: 'effectiveEnd',
            operation: 0,
            type: 3,
            gte: '2026-11-14T19:00:00.000Z',
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 0,
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 1,
            value: ['COMPLETED'],
          },
          {
            field: 'dynamicSearchFields.blockEffectiveEnd',
            operation: 1,
            type: 0,
          },
        ],
        modules: [{ moduleType: 'trip', viewTypes: ['tour', 'tourTerminal'] }],
        loadTypeFilters: ['All'],
      },
      {
        query: [
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 1,
            type: 1,
            value: ['DRAFT'],
          },
          {
            field: 'dynamicSearchFields.keywords',
            operation: 1,
            type: 1,
            value: ['IGNORE_FOR_TRIP'],
          },
          {
            field: 'dynamicSearchFields.isAdhocLoad',
            operation: 0,
            type: 1,
            value: ['true'],
          },
          {
            field: 'effectiveStart',
            operation: 0,
            type: 3,
            lte: '2026-11-21T18:59:59.999Z',
          },
          {
            field: 'effectiveEnd',
            operation: 0,
            type: 3,
            gte: '2026-11-14T19:00:00.000Z',
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 0,
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 1,
            value: ['REJECTED', 'CANCELLED', 'COMPLETED'],
          },
        ],
        modules: [
          { moduleType: 'trip', viewTypes: ['vehicleRun', 'vehicleRunTerminal'] },
        ],
        loadTypeFilters: ['All'],
      },
      {
        query: [
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 0,
          },
          {
            field: 'dynamicSearchFields.hasTour',
            operation: 0,
            type: 1,
            value: ['false'],
          },
          {
            field: 'effectiveEnd',
            operation: 0,
            type: 3,
            gte: '2026-11-14T19:00:00.000Z',
          },
          {
            field: 'effectiveStart',
            operation: 0,
            type: 3,
            lte: '2026-11-21T18:59:59.999Z',
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 1,
            value: ['UPCOMING', 'ASSIGNED', 'UNUSED_BLOCK'],
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 1,
            type: 1,
            value: ['DRAFT'],
          },
          {
            field: 'dynamicSearchFields.keywords',
            operation: 1,
            type: 1,
            value: ['IGNORE_FOR_TRIP'],
          },
          {
            field: 'effectiveEnd',
            operation: 1,
            type: 3,
            gte: '2026-11-17T14:14:46.351Z',
          },
        ],
        modules: [{ moduleType: 'capacity', viewTypes: ['block'] }],
      },
      {
        query: [
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 1,
            value: ['CANCELLED', 'REJECTED', 'COMPLETED'],
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 1,
            type: 1,
            value: ['DRAFT'],
          },
          {
            field: 'dynamicSearchFields.keywords',
            operation: 1,
            type: 1,
            value: ['IGNORE_FOR_TRIP'],
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 0,
          },
          {
            field: 'dynamicSearchFields.hasTour',
            operation: 0,
            type: 1,
            value: ['false'],
          },
          {
            field: 'effectiveEnd',
            operation: 0,
            type: 3,
            gte: '2026-11-14T19:00:00.000Z',
          },
          {
            field: 'effectiveStart',
            operation: 0,
            type: 3,
            lte: '2026-11-21T18:59:59.999Z',
          },
        ],
        modules: [{ moduleType: 'capacity', viewTypes: ['block'] }],
      },
    ],
    sort: [
      { field: 'dynamicSortFields.isRetendered', direction: 1, type: 0 },
      { field: 'dynamicSortFields.unaccepted', direction: 1, type: 0 },
      { field: 'dynamicSortFields.startTime', direction: 0, type: 0 },
      { field: 'dynamicSortFields.startTime', direction: 0, type: 0 },
    ],
    pagination: { size: 100, from: 0 },
    tileCountTab: 'HISTORY',
  },
  UPCOMING: {
    filter: [
      {
        query: [
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 1,
            type: 1,
            value: ['DRAFT'],
          },
          {
            field: 'dynamicSearchFields.keywords',
            operation: 1,
            type: 1,
            value: ['IGNORE_FOR_TRIP'],
          },
          {
            field: 'effectiveStart',
            operation: 0,
            type: 3,
            lte: '2027-05-14T19:00:00.000Z',
          },
          {
            field: 'effectiveEnd',
            operation: 0,
            type: 3,
            gte: '2026-10-31T19:00:00.000Z',
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 0,
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 1,
            value: ['UPCOMING', 'ASSIGNED', 'UNUSED_BLOCK'],
          },
        ],
        modules: [{ moduleType: 'trip', viewTypes: ['tour', 'tourTerminal'] }],
        loadTypeFilters: ['All'],
      },
      {
        query: [
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 1,
            type: 1,
            value: ['DRAFT'],
          },
          {
            field: 'dynamicSearchFields.keywords',
            operation: 1,
            type: 1,
            value: ['IGNORE_FOR_TRIP'],
          },
          {
            field: 'effectiveStart',
            operation: 0,
            type: 3,
            lte: '2027-05-14T19:00:00.000Z',
          },
          {
            field: 'effectiveEnd',
            operation: 0,
            type: 3,
            gte: '2026-11-17T14:17:55.703Z',
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 0,
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 1,
            value: ['CANCELLED'],
          },
          {
            field: 'dynamicSearchFields.keywords',
            operation: 1,
            type: 1,
            value: ['IS_CANCELLED_RECOMMENDATION_BOOKED'],
          },
        ],
        modules: [{ moduleType: 'trip', viewTypes: ['tour', 'tourTerminal'] }],
        loadTypeFilters: ['All'],
      },
      {
        query: [
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 1,
            type: 1,
            value: ['DRAFT'],
          },
          {
            field: 'dynamicSearchFields.keywords',
            operation: 1,
            type: 1,
            value: ['IGNORE_FOR_TRIP'],
          },
          {
            field: 'dynamicSearchFields.isAdhocLoad',
            operation: 0,
            type: 1,
            value: ['true'],
          },
          {
            field: 'effectiveStart',
            operation: 0,
            type: 3,
            lte: '2027-05-14T19:00:00.000Z',
          },
          {
            field: 'effectiveEnd',
            operation: 0,
            type: 3,
            gte: '2026-11-17T14:17:55.703Z',
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 0,
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 1,
            value: ['CANCELLED'],
          },
          {
            field: 'dynamicSearchFields.keywords',
            operation: 1,
            type: 1,
            value: ['IS_CANCELLED_RECOMMENDATION_BOOKED'],
          },
        ],
        modules: [
          { moduleType: 'trip', viewTypes: ['vehicleRun', 'vehicleRunTerminal'] },
        ],
        loadTypeFilters: ['All'],
      },
      {
        query: [
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 1,
            type: 1,
            value: ['DRAFT'],
          },
          {
            field: 'dynamicSearchFields.keywords',
            operation: 1,
            type: 1,
            value: ['IGNORE_FOR_TRIP'],
          },
          {
            field: 'dynamicSearchFields.isAdhocLoad',
            operation: 0,
            type: 1,
            value: ['true'],
          },
          {
            field: 'effectiveStart',
            operation: 0,
            type: 3,
            lte: '2027-05-14T19:00:00.000Z',
          },
          {
            field: 'effectiveEnd',
            operation: 0,
            type: 3,
            gte: '2026-10-31T19:00:00.000Z',
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 0,
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 1,
            value: ['UPCOMING', 'ASSIGNED', 'UNUSED_BLOCK'],
          },
        ],
        modules: [
          { moduleType: 'trip', viewTypes: ['vehicleRun', 'vehicleRunTerminal'] },
        ],
        loadTypeFilters: ['All'],
      },
      {
        query: [
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 0,
          },
          {
            field: 'dynamicSearchFields.hasTour',
            operation: 0,
            type: 1,
            value: ['false'],
          },
          {
            field: 'effectiveEnd',
            operation: 0,
            type: 3,
            gte: '2026-10-31T19:00:00.000Z',
          },
          {
            field: 'effectiveStart',
            operation: 0,
            type: 3,
            lte: '2027-05-14T19:00:00.000Z',
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 0,
            type: 1,
            value: ['UPCOMING', 'ASSIGNED', 'UNUSED_BLOCK'],
          },
          {
            field: 'dynamicSearchFields.visibilityStatus',
            operation: 1,
            type: 1,
            value: ['DRAFT'],
          },
          {
            field: 'dynamicSearchFields.keywords',
            operation: 1,
            type: 1,
            value: ['IGNORE_FOR_TRIP'],
          },
          {
            field: 'effectiveEnd',
            operation: 0,
            type: 3,
            gte: '2026-11-17T14:17:55.703Z',
          },
        ],
        modules: [{ moduleType: 'capacity', viewTypes: ['block'] }],
      },
    ],
    sort: [
      { field: 'dynamicSortFields.isRetendered', direction: 1, type: 0 },
      { field: 'dynamicSortFields.unaccepted', direction: 1, type: 0 },
      { field: 'dynamicSortFields.startTime', direction: 0, type: 0 },
      { field: 'dynamicSortFields.startTime', direction: 0, type: 0 },
    ],
    pagination: { size: 100, from: 0 },
    tileCountTab: 'UPCOMING',
  },
};

export const DEFAULT_TIMEZONE = 'Asia/Tashkent';
export const NOW_NEAR_CAPTURE_MS = 5 * 60 * 1000;
export const HISTORY_WINDOW_DAYS = 7;
export const HISTORY_BACKFILL_DAYS = 45;
export const UPCOMING_LOOKBACK_DAYS = 17;
export const UPCOMING_FORWARD_MONTHS = 6;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Local calendar parts in `timeZone` for a Date. */
export function zonedParts(date, timeZone = DEFAULT_TIMEZONE) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const map = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday] ?? 0,
  };
}

function zoneOffsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** Convert a wall-clock local datetime in `timeZone` to UTC Date. */
export function zonedLocalToUtc(
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
  timeZone = DEFAULT_TIMEZONE,
) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const off1 = zoneOffsetMs(new Date(utc), timeZone);
  utc -= off1;
  const off2 = zoneOffsetMs(new Date(utc), timeZone);
  if (off2 !== off1) utc = Date.UTC(year, month - 1, day, hour, minute, second, ms) - off2;
  return new Date(utc);
}

export function localMidnightUtc(year, month, day, timeZone = DEFAULT_TIMEZONE) {
  return zonedLocalToUtc(year, month, day, 0, 0, 0, 0, timeZone);
}

/** End of local calendar day = next local midnight − 1ms (avoids 23:59:59.999 offset edge cases). */
export function localEndOfDayUtc(year, month, day, timeZone = DEFAULT_TIMEZONE) {
  const next = addLocalDays(year, month, day, 1);
  return new Date(localMidnightUtc(next.year, next.month, next.day, timeZone).getTime() - 1);
}

export function addLocalDays(year, month, day, deltaDays) {
  const utc = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

export function addLocalMonths(year, month, day, deltaMonths) {
  const utc = new Date(Date.UTC(year, month - 1 + deltaMonths, day));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

/**
 * HISTORY window containing `now`: Sunday 00:00 → Saturday 23:59:59.999 local
 * (matches captured Nov 15–21 week for Asia/Tashkent).
 */
export function historyWindowContaining(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const p = zonedParts(now, timeZone);
  const sunday = addLocalDays(p.year, p.month, p.day, -p.weekday);
  const saturday = addLocalDays(sunday.year, sunday.month, sunday.day, HISTORY_WINDOW_DAYS - 1);
  return {
    startISO: localMidnightUtc(sunday.year, sunday.month, sunday.day, timeZone).toISOString(),
    endISO: localEndOfDayUtc(saturday.year, saturday.month, saturday.day, timeZone).toISOString(),
    sunday,
    saturday,
    label: `${sunday.year}-${pad2(sunday.month)}-${pad2(sunday.day)}`,
  };
}

/** Newest-first HISTORY windows covering at least `backfillDays`. */
export function listHistoryBackfillWindows(
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
  backfillDays = HISTORY_BACKFILL_DAYS,
) {
  const windows = [];
  let cursor = historyWindowContaining(now, timeZone);
  const oldestNeeded = (() => {
    const p = zonedParts(now, timeZone);
    return addLocalDays(p.year, p.month, p.day, -(backfillDays - 1));
  })();
  const oldestMs = localMidnightUtc(
    oldestNeeded.year,
    oldestNeeded.month,
    oldestNeeded.day,
    timeZone,
  ).getTime();

  for (let i = 0; i < 16; i += 1) {
    windows.push({
      index: i,
      startISO: cursor.startISO,
      endISO: cursor.endISO,
      label: cursor.label,
      sunday: cursor.sunday,
      saturday: cursor.saturday,
    });
    const startMs = Date.parse(cursor.startISO);
    if (startMs <= oldestMs) break;
    const prevSun = addLocalDays(cursor.sunday.year, cursor.sunday.month, cursor.sunday.day, -7);
    const prevSat = addLocalDays(prevSun.year, prevSun.month, prevSun.day, 6);
    cursor = {
      startISO: localMidnightUtc(prevSun.year, prevSun.month, prevSun.day, timeZone).toISOString(),
      endISO: localEndOfDayUtc(prevSat.year, prevSat.month, prevSat.day, timeZone).toISOString(),
      sunday: prevSun,
      saturday: prevSat,
      label: `${prevSun.year}-${pad2(prevSun.month)}-${pad2(prevSun.day)}`,
    };
  }
  return windows;
}

/** True during the first 24h after local Sunday 00:00 (new HISTORY week). */
export function isFirst24hOfHistoryWeek(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const p = zonedParts(now, timeZone);
  if (p.weekday !== 0) return false;
  const weekStart = localMidnightUtc(p.year, p.month, p.day, timeZone).getTime();
  return now.getTime() - weekStart < 24 * 60 * 60 * 1000;
}

/** UPCOMING: today−17d 00:00 → today+6 months 00:00 local. */
export function upcomingWindow(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const p = zonedParts(now, timeZone);
  const start = addLocalDays(p.year, p.month, p.day, -UPCOMING_LOOKBACK_DAYS);
  const end = addLocalMonths(p.year, p.month, p.day, UPCOMING_FORWARD_MONTHS);
  return {
    startISO: localMidnightUtc(start.year, start.month, start.day, timeZone).toISOString(),
    endISO: localMidnightUtc(end.year, end.month, end.day, timeZone).toISOString(),
  };
}

function isIsoTimestamp(v) {
  return typeof v === 'string' && ISO_RE.test(v);
}

function nearCapture(iso, captureMs, nowNearMs = NOW_NEAR_CAPTURE_MS) {
  const t = Date.parse(iso);
  return Number.isFinite(t) && Number.isFinite(captureMs) && Math.abs(t - captureMs) <= nowNearMs;
}

/**
 * Mark query conditions that carry a "now" timestamp (must not be overwritten by setWindow).
 * Returns WeakSet of condition objects.
 */
export function markNowConditions(body, captureAtIso) {
  const marked = new Set();
  const captureMs = Date.parse(captureAtIso || '') || NaN;
  for (const filterObj of body?.filter || []) {
    for (const cond of filterObj?.query || []) {
      if (!cond || typeof cond !== 'object') continue;
      if (
        cond.field === 'dynamicSearchFields.blockEffectiveEnd' &&
        Object.prototype.hasOwnProperty.call(cond, 'lte')
      ) {
        marked.add(cond);
        continue;
      }
      for (const key of ['lte', 'gte']) {
        if (isIsoTimestamp(cond[key]) && nearCapture(cond[key], captureMs)) {
          marked.add(cond);
        }
      }
    }
  }
  return marked;
}

/**
 * In EVERY filter[] query object, set effectiveEnd.gte / effectiveStart.lte
 * only on conditions that already have those fields and are not "now" markers.
 */
export function setWindow(body, startISO, endISO, nowMarked = null) {
  for (const filterObj of body?.filter || []) {
    for (const cond of filterObj?.query || []) {
      if (!cond || typeof cond !== 'object') continue;
      if (nowMarked && nowMarked.has(cond)) continue;
      if (
        cond.field === 'effectiveEnd' &&
        Object.prototype.hasOwnProperty.call(cond, 'gte')
      ) {
        cond.gte = startISO;
      }
      if (
        cond.field === 'effectiveStart' &&
        Object.prototype.hasOwnProperty.call(cond, 'lte')
      ) {
        cond.lte = endISO;
      }
    }
  }
  return body;
}

/**
 * Refresh capture-time "now" timestamps. Mutates body (caller must deep-clone first).
 */
export function refreshNowTimestamps(body, captureAtIso, nowIso = new Date().toISOString()) {
  const captureMs = Date.parse(captureAtIso || '') || NaN;
  for (const filterObj of body?.filter || []) {
    for (const cond of filterObj?.query || []) {
      if (!cond || typeof cond !== 'object') continue;
      if (
        cond.field === 'dynamicSearchFields.blockEffectiveEnd' &&
        Object.prototype.hasOwnProperty.call(cond, 'lte')
      ) {
        cond.lte = nowIso;
        continue;
      }
      for (const key of ['lte', 'gte']) {
        if (isIsoTimestamp(cond[key]) && nearCapture(cond[key], captureMs)) {
          cond[key] = nowIso;
        }
      }
    }
  }
  return body;
}

/**
 * Build a ready-to-send body for a tab from a stored/fallback template.
 * Never mutates the stored template.
 */
export function buildTabRequestBody(
  tileCountTab,
  template,
  { from = 0, size = 100, now = new Date(), timeZone = DEFAULT_TIMEZONE, historyWindow = null } = {},
) {
  if (!template?.body) {
    return { ok: false, error: 'no_template', body: null };
  }
  const body = deepClone(template.body);
  body.tileCountTab = tileCountTab;
  body.pagination = {
    ...(body.pagination || {}),
    size,
    from,
  };

  const captureAt = template.at || FALLBACK_CAPTURED_AT[tileCountTab] || now.toISOString();
  const nowMarked = markNowConditions(body, captureAt);

  if (tileCountTab === 'UPCOMING') {
    const win = upcomingWindow(now, timeZone);
    setWindow(body, win.startISO, win.endISO, nowMarked);
  } else if (tileCountTab === 'HISTORY') {
    const win = historyWindow || historyWindowContaining(now, timeZone);
    setWindow(body, win.startISO, win.endISO, nowMarked);
  }

  refreshNowTimestamps(body, captureAt, now.toISOString());
  return { ok: true, body, captureAt, window: historyWindow || null };
}

export function fallbackTemplate(tileCountTab) {
  const body = FALLBACK_BODIES[tileCountTab];
  if (!body) return null;
  return {
    body: deepClone(body),
    headers: {},
    at: FALLBACK_CAPTURED_AT[tileCountTab],
    source: 'fallback',
    pageUrl: null,
  };
}

/** Expected tourState / status families per tab (soft cross-check). */
export const TAB_STATUS_HINTS = {
  UPCOMING: new Set(['UPCOMING', 'ASSIGNED', 'UNUSED_BLOCK', 'PLANNED', 'SCHEDULED']),
  IN_TRANSIT: new Set(['IN_TRANSIT', 'INTRANSIT', 'ACTIVE', 'EN_ROUTE', 'ENROUTE', 'STARTED']),
  HISTORY: new Set(['COMPLETED', 'CANCELLED', 'CANCELED', 'REJECTED', 'HISTORY']),
};

export function crossCheckTripSection(tileCountTab, trip) {
  const hints = TAB_STATUS_HINTS[tileCountTab];
  if (!hints) return { ok: true };
  const raw = String(trip?.tourState || trip?.executionStatus || trip?.status || '').toUpperCase();
  if (!raw) return { ok: true };
  // Soft check: only flag clear mismatches across live boards
  if (tileCountTab === 'UPCOMING' && TAB_STATUS_HINTS.IN_TRANSIT.has(raw)) {
    return { ok: false, reason: `tourState ${raw} looks like IN_TRANSIT` };
  }
  if (tileCountTab === 'IN_TRANSIT' && hints.has('UPCOMING') === false && TAB_STATUS_HINTS.UPCOMING.has(raw)) {
    return { ok: false, reason: `tourState ${raw} looks like UPCOMING` };
  }
  return { ok: true };
}
