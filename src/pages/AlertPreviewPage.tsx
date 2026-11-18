import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { supabase, SUPABASE_URL } from '@/lib/supabase';

type DryRunMeta = {
  driver?: string | null;
  group_title?: string | null;
  tractor?: string | null;
  trailer?: string | null;
  planned?: string | null;
  actual?: string | null;
  eta?: string | null;
  facility?: string | null;
  stop_seq?: number | null;
  stop_type?: string | null;
};

type DryRunRow = {
  id: string;
  trip_id: string;
  stop_id: string;
  alert_type: string;
  chat_id: string | null;
  driver_id: string | null;
  html: string;
  reason: string | null;
  sync_basis: string | null;
  would_send_at: string;
  meta: DryRunMeta | null;
};

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 24);
  return d.toLocaleString();
}

export function AlertPreviewPage() {
  const [rows, setRows] = useState<DryRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('dry_run_alerts')
      .select(
        'id, trip_id, stop_id, alert_type, chat_id, driver_id, html, reason, sync_basis, would_send_at, meta',
      )
      .order('would_send_at', { ascending: false })
      .limit(200);
    if (err) setError(err.message);
    setRows((data as DryRunRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runDryRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/trip-alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dry_run', window_hours: 1 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          `Dry-run invoke failed (${res.status}). Needs cron/service auth from Edge. ${JSON.stringify(body).slice(0, 200)}`,
        );
      } else {
        setLastRun(
          `Fresh 1h: ${body.preview_count ?? '?'} rows · ${body.unique_keys ?? '?'} unique · dupes ${
            body.duplicate_keys ?? '?'
          } · kill ${body.kill_switch ? 'ON' : 'OFF'}`,
        );
      }
    } catch (e) {
      setError(String(e));
    }
    await load();
    setRunning(false);
  };

  const arrived = rows.filter((r) => r.alert_type === 'arrived').length;
  const notAt = rows.filter((r) => r.alert_type === 'not_at_stop').length;
  const dupeKeys = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.trip_id}|${r.stop_id}|${r.alert_type}|${r.chat_id || '(none)'}`;
      map.set(k, (map.get(k) || 0) + 1);
    }
    return [...map.values()].filter((n) => n > 1).length;
  }, [rows]);

  return (
    <div>
      <PageHeader
        title="Alert preview"
        subtitle="Live 1h dry-run only (ARRIVED + NOT AT STOP). Kill switch OFF — nothing is sent. Never seeds prod."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => void runDryRun()} disabled={running}>
          <RefreshCw className={`mr-2 h-4 w-4 ${running ? 'animate-spin' : ''}`} />
          Run 1h dry-run
        </Button>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
        {lastRun && <span className="text-sm text-text-secondary">{lastRun}</span>}
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Bell className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-display font-bold">{rows.length}</p>
              <p className="text-xs text-text-secondary">Would-send</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-2xl font-display font-bold">{arrived}</p>
            <p className="text-xs text-text-secondary">ARRIVED</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-2xl font-display font-bold">{notAt}</p>
            <p className="text-xs text-text-secondary">NOT AT STOP</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-2xl font-display font-bold">{dupeKeys}</p>
            <p className="text-xs text-text-secondary">Duplicate keys</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>dry_run_alerts (max 1 per trip/stop/type/chat)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-text-secondary">Loading…</p>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-text-secondary">
              Empty. Run “Run 1h dry-run” (authenticated Edge call) against live Relay data.
            </p>
          )}
          {rows.map((r) => {
            const m = r.meta || {};
            return (
              <div key={r.id} className="rounded-lg border border-border bg-bg p-3 text-sm">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge status={r.alert_type} />
                  <span className="font-medium">{m.driver || '—'}</span>
                  <span className="text-xs text-text-secondary">
                    {m.group_title || (r.chat_id ? `chat ${r.chat_id}` : 'no linked group')}
                  </span>
                  <span className="font-mono text-xs">{r.trip_id}</span>
                  <span className="text-xs text-text-secondary">{r.stop_id}</span>
                  <span className="ml-auto text-[10px] text-text-secondary">
                    {new Date(r.would_send_at).toLocaleString()}
                  </span>
                </div>
                <div className="mb-2 grid gap-1 text-xs text-text-secondary sm:grid-cols-2">
                  <span>
                    Facility {m.facility || '—'} · stop {m.stop_seq ?? '—'} {m.stop_type || ''}
                  </span>
                  <span>
                    Tractor {m.tractor || '—'} · Trailer {m.trailer || '—'}
                  </span>
                  <span>Scheduled {fmtTime(m.planned)}</span>
                  <span>
                    {r.alert_type === 'arrived'
                      ? `Actual ${fmtTime(m.actual)}`
                      : `ETA ${fmtTime(m.eta)}`}
                  </span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-text-primary">
                  {r.html.replace(/<[^>]+>/g, '')}
                </pre>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
