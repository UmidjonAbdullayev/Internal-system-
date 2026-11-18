/**
 * Lean, paginated CRM fetches — performance only (no money formula changes).
 */
import {
  supabase,
  fetchAllPages,
  RELAY_TRIP_LIST_COLUMNS,
  RELAY_LEG_LIST_COLUMNS,
  RELAY_STOP_LIST_COLUMNS,
  SUPABASE_PAGE_SIZE,
} from '@/lib/supabase';
import { assembleRelayTrips } from '@/lib/supabaseMappers';
import type { RelaySection, RelayTrip } from '@/types';

/** UI list page size (virtualized windows still fetch in chunks). */
export const CRM_LIST_PAGE = 100;

/** PostgREST `.in()` practical chunk size. */
const IN_CHUNK = 150;

export const REPORT_LOAD_LIST_COLUMNS = [
  'trip_uuid',
  'trip_id',
  'tour_id',
  'trip_display',
  'load_ids',
  'leg_count',
  'broker',
  'driver_name',
  'driver_name_raw',
  'pickup_date',
  'delivery_date',
  'pu_location',
  'del_location',
  'tour_start_ts',
  'tour_start_la',
  'week_start',
  'week_end',
  'amazon_week',
  'amazon_week_year',
  'week_label',
  'estimated_week',
  'week_source',
  'invoice_id',
  'paid_status',
  'mile',
  'amazon_paid',
  'driver_paid',
  'rpm',
  'comment',
  'dispatch',
  'section',
  'status',
  'execution_status',
  'last_seen_at',
  'updated_at',
  'has_override',
  'override_source',
  'is_tonu',
  'money_bucket',
].join(',');

/** Lean loads columns for status / overview (skip bulky unused fields). */
export const LOAD_LIST_COLUMNS = [
  'id',
  'load_id',
  'amazon_ref_id',
  'driver_id',
  'load_status',
  'payment_status',
  'pickup_location',
  'delivery_location',
  'pickup_date',
  'delivery_date',
  'trailer_id',
  'trailer_type',
  'tractor_id',
  'distance_miles',
  'rate_gross',
  'additional_charges',
  'payment_date',
  'notes',
  'parent_trip_id',
  'trip_bucket',
  'archived',
  'last_observed',
  'created_at',
  'updated_at',
].join(',');

async function fetchInChunks<T extends Record<string, unknown>>(
  column: string,
  ids: string[],
  build: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  if (ids.length === 0) return { data: [], error: null };
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await build(chunk);
    if (error) return { data: out, error: { message: error.message } };
    out.push(...(data || []));
  }
  return { data: out, error: null };
}

export async function countRelayTripsBySection(): Promise<Record<RelaySection, number>> {
  const sections: RelaySection[] = ['IN_TRANSIT', 'UPCOMING', 'HISTORY'];
  const counts: Record<RelaySection, number> = {
    IN_TRANSIT: 0,
    UPCOMING: 0,
    HISTORY: 0,
  };
  await Promise.all(
    sections.map(async (section) => {
      const { count, error } = await supabase
        .from('relay_trips')
        .select('id', { count: 'exact', head: true })
        .eq('archived', false)
        .eq('section', section);
      if (!error && count != null) counts[section] = count;
    }),
  );
  return counts;
}

export type FetchTripsOpts = {
  sections?: RelaySection[];
  /** History end-date window (ISO yyyy-mm-dd) applied on end_time when set. */
  endFrom?: string | null;
  endTo?: string | null;
  limit?: number;
  offset?: number;
  /** When false, skip stop rows (faster list; expand can refill). Default true. */
  includeStops?: boolean;
};

/** Section-scoped trips + matching legs/stops (avoids hydrating all History when viewing live). */
export async function fetchRelayTripsScoped(
  opts: FetchTripsOpts = {},
): Promise<{ trips: RelayTrip[]; error: string | null; tripIds: string[] }> {
  const sections = opts.sections;
  const includeStops = opts.includeStops !== false;
  const limit = opts.limit ?? SUPABASE_PAGE_SIZE;
  const offset = opts.offset ?? 0;

  let tripQuery = supabase
    .from('relay_trips')
    .select(RELAY_TRIP_LIST_COLUMNS)
    .eq('archived', false)
    .order('last_seen_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (sections?.length === 1) {
    tripQuery = tripQuery.eq('section', sections[0]);
  } else if (sections && sections.length > 1) {
    tripQuery = tripQuery.in('section', sections);
  }

  if (opts.endFrom) {
    tripQuery = tripQuery.gte('end_time', `${opts.endFrom}T00:00:00`);
  }
  if (opts.endTo) {
    tripQuery = tripQuery.lte('end_time', `${opts.endTo}T23:59:59.999`);
  }

  const { data: tripRows, error: tripErr } = await tripQuery;
  if (tripErr) return { trips: [], error: tripErr.message, tripIds: [] };
  const rows = (tripRows || []) as Record<string, unknown>[];
  const tripIds = rows.map((r) => String(r.trip_id)).filter(Boolean);
  if (tripIds.length === 0) return { trips: [], error: null, tripIds: [] };

  const [legsRes, stopsRes] = await Promise.all([
    fetchInChunks<Record<string, unknown>>('trip_id', tripIds, (chunk) =>
      supabase
        .from('relay_legs')
        .select(RELAY_LEG_LIST_COLUMNS)
        .eq('archived', false)
        .in('trip_id', chunk),
    ),
    includeStops
      ? fetchInChunks<Record<string, unknown>>('trip_id', tripIds, (chunk) =>
          supabase
            .from('relay_stops')
            .select(RELAY_STOP_LIST_COLUMNS)
            .eq('archived', false)
            .in('trip_id', chunk)
            .order('seq', { ascending: true }),
        )
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
  ]);
  if (legsRes.error) return { trips: [], error: legsRes.error.message, tripIds };
  if (stopsRes.error) return { trips: [], error: stopsRes.error.message, tripIds };

  return {
    trips: assembleRelayTrips(rows, legsRes.data, stopsRes.data),
    error: null,
    tripIds,
  };
}

/** Fill stops for already-assembled trips (expand / history backfill). */
export async function fetchStopsForTripIds(
  tripIds: string[],
): Promise<{ data: Record<string, unknown>[]; error: string | null }> {
  const res = await fetchInChunks<Record<string, unknown>>('trip_id', tripIds, (chunk) =>
    supabase
      .from('relay_stops')
      .select(RELAY_STOP_LIST_COLUMNS)
      .eq('archived', false)
      .in('trip_id', chunk)
      .order('seq', { ascending: true }),
  );
  return { data: res.data, error: res.error?.message ?? null };
}

export async function fetchReportLoads(opts?: {
  weekStartGte?: string;
  weekStartLte?: string;
}): Promise<{ data: Record<string, unknown>[]; error: string | null }> {
  const res = await fetchAllPages<Record<string, unknown>>((from, to) => {
    let q = supabase
      .from('report_loads')
      // View columns only — explicit list keeps payload stable if view gains heavy cols later.
      .select(REPORT_LOAD_LIST_COLUMNS)
      .order('tour_start_la', { ascending: true })
      .range(from, to);
    if (opts?.weekStartGte) q = q.gte('week_start', opts.weekStartGte);
    if (opts?.weekStartLte) q = q.lte('week_start', opts.weekStartLte);
    return q as unknown as PromiseLike<{
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    }>;
  }, SUPABASE_PAGE_SIZE);
  return { data: res.data, error: res.error?.message ?? null };
}

/** Fleet Amazon paid for a week window — same filter semantics as client income sum (view rows). */
export async function fetchFleetAmazonPaidSum(
  weekStart: string,
  weekEnd: string,
): Promise<{ sum: number; error: string | null }> {
  const { data, error } = await supabase
    .from('report_loads')
    .select('amazon_paid, money_bucket, week_start, tour_start_la')
    .or(
      `and(week_start.gte.${weekStart},week_start.lte.${weekEnd}),and(week_start.is.null,tour_start_la.gte.${weekStart},tour_start_la.lte.${weekEnd})`,
    );

  if (error) return { sum: 0, error: error.message };
  let sum = 0;
  for (const row of data || []) {
    const bucket = String((row as { money_bucket?: string }).money_bucket || '');
    if (bucket && bucket !== 'income') continue;
    const n = Number((row as { amazon_paid?: number }).amazon_paid);
    if (Number.isFinite(n)) sum += n;
  }
  return { sum: Math.round((sum + Number.EPSILON) * 100) / 100, error: null };
}

export async function fetchLoadsLean(): Promise<{
  data: Record<string, unknown>[];
  error: string | null;
}> {
  const res = await fetchAllPages<Record<string, unknown>>(
    (from, to) =>
      supabase
        .from('loads')
        .select(LOAD_LIST_COLUMNS)
        .order('created_at', { ascending: false })
        .range(from, to) as unknown as PromiseLike<{
        data: Record<string, unknown>[] | null;
        error: { message: string } | null;
      }>,
    SUPABASE_PAGE_SIZE,
  );
  return { data: res.data, error: res.error?.message ?? null };
}
