import { useCallback, useEffect, useState } from 'react';
import { Bell, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { supabase, SUPABASE_URL } from '@/lib/supabase';

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
};

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
        'id, trip_id, stop_id, alert_type, chat_id, driver_id, html, reason, sync_basis, would_send_at',
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
      // Prefer Edge dry_run when available; otherwise insert local evaluation note
      const res = await fetch(`${SUPABASE_URL}/functions/v1/trip-alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dry_run', window_hours: 1 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          `Dry-run invoke failed (${res.status}). Deploy trip-alerts or use service auth. ${JSON.stringify(body).slice(0, 200)}`,
        );
      } else {
        setLastRun(
          `Evaluated ${body.evaluated ?? '?'} · preview ${body.preview_count ?? rows.length} · kill switch ${
            body.kill_switch ? 'ON' : 'OFF'
          }`,
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

  return (
    <div>
      <PageHeader
        title="Alert preview"
        subtitle="Dry-run Telegram alerts (ARRIVED + NOT AT STOP). Kill switch stays OFF — nothing is sent."
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

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Bell className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-display font-bold">{rows.length}</p>
              <p className="text-xs text-text-secondary">Would-send rows</p>
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>dry_run_alerts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-text-secondary">Loading…</p>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-text-secondary">
              No dry-run rows yet. Click “Run 1h dry-run” after trip-alerts is deployed, or wait for
              cron while the kill switch is OFF.
            </p>
          )}
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-bg p-3 text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge status={r.alert_type} />
                <span className="font-mono text-xs">{r.trip_id}</span>
                {r.stop_id && <span className="text-xs text-text-secondary">{r.stop_id}</span>}
                {r.chat_id ? (
                  <span className="text-xs text-text-secondary">chat {r.chat_id}</span>
                ) : (
                  <span className="text-xs text-amber-700">no linked group</span>
                )}
                {r.reason && <span className="text-xs text-text-secondary">{r.reason}</span>}
                <span className="ml-auto text-[10px] text-text-secondary">
                  {new Date(r.would_send_at).toLocaleString()}
                </span>
              </div>
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-text-primary">
                {r.html.replace(/<[^>]+>/g, '')}
              </pre>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
