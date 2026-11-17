import { createClient } from '@supabase/supabase-js';

/** Internal Sys CRM — same project as Relay extension. Anon/publishable only. */
export const SUPABASE_URL = 'https://iiyqkdjwxlnfqvlidbqr.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpeXFrZGp3eGxuZnF2bGlkYnFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODE5NjEsImV4cCI6MjExMDE1Nzk2MX0.ZYLoih1BegKKx-UN-aaz4qMuriJ_vr05QRW4hUR_zm8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** PostgREST default max-rows is 1000 — page until exhausted. */
export const SUPABASE_PAGE_SIZE = 1000;

/**
 * Lean trip columns for CRM list hydrate.
 * Excludes `raw` jsonb (~12MB+) which caused production statement timeouts.
 */
export const RELAY_TRIP_LIST_COLUMNS =
  'id,trip_id,section,relay_version,last_seen_at,tour_state,execution_status,work_type,business_type,start_time,end_time,total_miles,payout,currency,rate_per_mile,driver_name_raw,equipment,status,content_hash,needs_review,archived,created_at,updated_at';

export const RELAY_LEG_LIST_COLUMNS =
  'id,load_id,trip_id,facility_sequence,execution_status,equipment_type,miles,payout,tractor_id,trailer_id,driver_name_raw,cpt,content_hash,archived,last_seen_at,created_at,updated_at';

export const RELAY_STOP_LIST_COLUMNS =
  'id,stop_id,load_id,trip_id,seq,stop_type,facility_code,address,city,state,zip,time_zone,scheduled_arrival,actual_arrival,scheduled_departure,actual_departure,eta,scheduled_arrival_local,actual_arrival_local,scheduled_departure_local,actual_departure_local,eta_local,late_reason,arrival_time_source,departure_time_source,archived,created_at,updated_at';

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/** Fetch all pages for a filtered select (handles PostgREST 1000-row cap). */
export async function fetchAllPages<T extends Record<string, unknown>>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = SUPABASE_PAGE_SIZE,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await buildPage(from, to);
    if (error) return { data: out, error: { message: error.message } };
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return { data: out, error: null };
}
