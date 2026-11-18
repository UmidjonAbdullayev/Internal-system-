import { useEffect, useMemo, useState } from 'react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import {
  filterReportLoadsByWeek,
  sumAmazonPaid,
} from '@/lib/reportLoadMoney';

const AMAZON_INVOICE_WEEK46 = 295626.3;

type TwinRow = {
  bare_load: string;
  row_count: number;
  load_ids: string[];
  trips: string[];
  amazon_amounts: number[];
  summed_amazon: number;
  max_amazon: number;
  double_counted_extra: number;
};

type StackedRow = {
  trip_key: string;
  trip_level_rows: number;
  leg_rows: number;
  trip_level_amazon: number;
  legs_amazon: number;
  total_if_all_counted: number;
  all_load_ids: string[];
};

export function DataChecksPage() {
  const { reportLoads, loadOverrides, dataReady } = useData();
  const [twins, setTwins] = useState<TwinRow[]>([]);
  const [stacked, setStacked] = useState<StackedRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [t, s] = await Promise.all([
        supabase.from('money_legacy_twin_pairs').select('*'),
        supabase.from('money_legacy_stacked_trips').select('*'),
      ]);
      if (cancelled) return;
      if (t.error || s.error) {
        setError(t.error?.message || s.error?.message || 'Failed to load legacy duplicate views');
        return;
      }
      setTwins(
        (t.data || []).map((r) => ({
          bare_load: String(r.bare_load),
          row_count: Number(r.row_count) || 0,
          load_ids: (r.load_ids as string[]) || [],
          trips: (r.trips as string[]) || [],
          amazon_amounts: ((r.amazon_amounts as unknown[]) || []).map((x) => Number(x) || 0),
          summed_amazon: Number(r.summed_amazon) || 0,
          max_amazon: Number(r.max_amazon) || 0,
          double_counted_extra: Number(r.double_counted_extra) || 0,
        })),
      );
      setStacked(
        (s.data || []).map((r) => ({
          trip_key: String(r.trip_key),
          trip_level_rows: Number(r.trip_level_rows) || 0,
          leg_rows: Number(r.leg_rows) || 0,
          trip_level_amazon: Number(r.trip_level_amazon) || 0,
          legs_amazon: Number(r.legs_amazon) || 0,
          total_if_all_counted: Number(r.total_if_all_counted) || 0,
          all_load_ids: (r.all_load_ids as string[]) || [],
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const week45 = useMemo(() => {
    const rows = filterReportLoadsByWeek(reportLoads, '2026-11-01', '2026-11-07');
    return { count: rows.length, amazon: sumAmazonPaid(rows) };
  }, [reportLoads]);

  const week46 = useMemo(() => {
    const rows = filterReportLoadsByWeek(reportLoads, '2026-11-08', '2026-11-14');
    return { count: rows.length, amazon: sumAmazonPaid(rows) };
  }, [reportLoads]);

  const twinExtra = twins.reduce((s, t) => s + t.double_counted_extra, 0);
  const stackedTripLevel = stacked.reduce((s, t) => s + t.trip_level_amazon, 0);
  const invoiceDelta = week46.amazon - AMAZON_INVOICE_WEEK46;

  return (
    <div>
      <PageHeader
        title="Data checks"
        subtitle="Money accuracy — report_loads weeks + legacy duplicate inventory (loads/load_reports kept)"
      />

      {!dataReady && <p className="text-sm text-text-secondary mb-4">Loading…</p>}
      {error && <p className="text-sm text-danger mb-4">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-6">
        <Metric
          title="Week 45"
          subtitle="Sun Nov 1 – Sat Nov 7, 2026 (LA)"
          lines={[`${week45.count} tours`, formatCurrency(week45.amazon) + ' Amazon']}
        />
        <Metric
          title="Week 46"
          subtitle="Sun Nov 8 – Sat Nov 14, 2026 (LA)"
          lines={[`${week46.count} tours`, formatCurrency(week46.amazon) + ' Amazon']}
          highlight
        />
        <Metric
          title="Amazon invoice W46"
          subtitle="External target"
          lines={[formatCurrency(AMAZON_INVOICE_WEEK46), `Δ report_loads ${formatCurrency(invoiceDelta)}`]}
        />
        <Metric
          title="Overrides migrated"
          subtitle="load_overrides from load_reports"
          lines={[`${loadOverrides.length} tours`, 'legacy tables retained']}
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Week 46 vs invoice
            <Badge status={Math.abs(invoiceDelta) < 1 ? 'Paid' : 'On Hold'} />
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p>
            <span className="font-medium">report_loads Week46:</span>{' '}
            {week46.count} tours · {formatCurrency(week46.amazon)}
          </p>
          <p>
            <span className="font-medium">Amazon invoice Week46:</span>{' '}
            {formatCurrency(AMAZON_INVOICE_WEEK46)}
          </p>
          <p>
            <span className="font-medium">Difference:</span> {formatCurrency(invoiceDelta)}{' '}
            <span className="text-text-secondary">
              (currently all weeks are pickup-estimated; MAIN invoice override via{' '}
              <code>money_invoice_tour_weeks</code> when payments agent wires invoice_trips)
            </span>
          </p>
          <p className="text-xs text-text-secondary">
            Week rule: MAIN invoice week wins when present; else pickup Sun–Sat America/Los_Angeles
            with <code>estimated_week=true</code>.
          </p>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>
            Legacy T-/bare twins ({twins.length}) — extra if summed{' '}
            {formatCurrency(twinExtra)}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-secondary">
                <th className="py-2 pr-2">Bare load</th>
                <th className="py-2 pr-2">load_ids</th>
                <th className="py-2 pr-2">Amounts</th>
                <th className="py-2 pr-2 text-right">Summed</th>
                <th className="py-2 pr-2 text-right">Extra</th>
              </tr>
            </thead>
            <tbody>
              {twins.map((t) => (
                <tr key={t.bare_load} className="border-b border-border/60">
                  <td className="py-2 pr-2 font-medium">{t.bare_load}</td>
                  <td className="py-2 pr-2 text-xs">{t.load_ids.join(', ')}</td>
                  <td className="py-2 pr-2 text-xs tabular-nums">
                    {t.amazon_amounts.map((a) => formatCurrency(a)).join(' · ')}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatCurrency(t.summed_amazon)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-danger">
                    {formatCurrency(t.double_counted_extra)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Legacy trip + legs stacked ({stacked.length}) — trip-level $ stacked{' '}
            {formatCurrency(stackedTripLevel)}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-secondary">
                <th className="py-2 pr-2">Trip</th>
                <th className="py-2 pr-2">Trip rows</th>
                <th className="py-2 pr-2">Leg rows</th>
                <th className="py-2 pr-2 text-right">Trip-level $</th>
                <th className="py-2 pr-2 text-right">Legs $</th>
                <th className="py-2 pr-2 text-right">If all counted</th>
                <th className="py-2 pr-2">load_ids</th>
              </tr>
            </thead>
            <tbody>
              {stacked.map((t) => (
                <tr key={t.trip_key} className="border-b border-border/60">
                  <td className="py-2 pr-2 font-medium">{t.trip_key}</td>
                  <td className="py-2 pr-2">{t.trip_level_rows}</td>
                  <td className="py-2 pr-2">{t.leg_rows}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {formatCurrency(t.trip_level_amazon)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatCurrency(t.legs_amazon)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {formatCurrency(t.total_if_all_counted)}
                  </td>
                  <td className="py-2 pr-2 text-xs max-w-[220px] truncate" title={t.all_load_ids.join(', ')}>
                    {t.all_load_ids.join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  title,
  subtitle,
  lines,
  highlight,
}: {
  title: string;
  subtitle: string;
  lines: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        highlight ? 'border-primary/40 bg-primary/5' : 'border-border bg-white'
      }`}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-[11px] text-text-secondary mb-2">{subtitle}</p>
      {lines.map((line) => (
        <p key={line} className="text-sm tabular-nums">
          {line}
        </p>
      ))}
    </div>
  );
}
