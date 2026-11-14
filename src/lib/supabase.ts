import { createClient } from '@supabase/supabase-js';

/** Internal Sys CRM — same project as Relay extension. Anon/publishable only. */
export const SUPABASE_URL = 'https://iiyqkdjwxlnfqvlidbqr.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpeXFrZGp3eGxuZnF2bGlkYnFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODE5NjEsImV4cCI6MjExMDE1Nzk2MX0.ZYLoih1BegKKx-UN-aaz4qMuriJ_vr05QRW4hUR_zm8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
