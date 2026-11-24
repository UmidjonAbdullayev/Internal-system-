import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Plus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { eachDayOfInterval, format, parseISO } from 'date-fns';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { KpiCard } from '@/components/ui/KpiCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input, Field, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SortHeader, useSort, type SortDir } from '@/components/shared/SortHeader';
import { PeriodPicker } from '@/components/gross/PeriodPicker';
import { defaultPeriod, periodRange, type PeriodState } from '@/components/gross/period';
import { STAGE_CLASS, STAGE_LABEL } from '@/components/gross/stage';
import {
  isEarnedRow,
  isInProgressRow,
  reportLoadsForDriver,
  rowStage,
  sumAmazonPaid,
} from '@/lib/reportLoadMoney';
import { amazonWeekRangeFromAnchor, laTodayISO } from '@/lib/amazonWeek';
import { getMonthRange } from '@/lib/calculations';
import { cn, downloadCSV, formatCurrency, formatDate, getDriverFullName } from '@/lib/utils';

/** One driver: their gross and every tour in the period, priced at the Amazon tour level. */
export function GrossByDriverDetailPage() {
  const { id = '' } = useParams();
  const { drivers, reportLoads, grossAdjustments, oneTimeCharges, addGrossAdjustment } = useData();
  const driver = drivers.find((d) => d.id === id);
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod);
  const [showCancelled, setShowCancelled] = useState(false);
  const [sortKey, setSortKey] = useState('start');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const range = periodRange(period);

  const adjIn = (start: string, end: string) =>
    grossAdjustments.filter((a) => a.driverId === id && a.date >= start && a.date <= end);
  const earnedIn = (start: string, end: string) => {
    const list = reportLoadsForDriver(reportLoads, drivers, id, start, end).filter(isEarnedRow);
    return Math.round((sumAmazonPaid(list) + adjIn(start, end).reduce((s, a) => s + a.amount, 0)) * 100) / 100;
  };

  const tours = useMemo(
    () => reportLoadsForDriver(reportLoads, drivers, id, range.start, range.end),
    [reportLoads, drivers, id, range.start, range.end],
  );
  const earnedRows = useMemo(() => tours.filter(isEarnedRow), [tours]);
  const inProgressRows = useMemo(() => tours.filter(isInProgressRow), [tours]);
  const periodAdjustments = adjIn(range.start, range.end);
  const earned = Math.round((sumAmazonPaid(earnedRows) + periodAdjustments.reduce((s, a) => s + a.amount, 0)) * 100) / 100;
  const charges = oneTimeCharges
    .filter((c) => c.driverId === id && c.date >= range.start && c.date <= range.end)
    .reduce((s, c) => s + c.amount, 0);
  const week = amazonWeekRangeFromAnchor(laTodayISO());
  const month = getMonthRange(laTodayISO());

  const listed = tours
    .map((t) => ({ t, stage: rowStage(t) }))
    .filter((r) => showCancelled || r.stage !== 'cancelled' || r.t.amazonPaid > 0);
  const sorted = useSort(listed, sortKey, sortDir, {
    start: (r) => r.t.tourStartLa || '',
    tour: (r) => r.t.tripDisplay,
    pay: (r) => r.t.amazonPaid,
    miles: (r) => Number(r.t.mile) || 0,
  });
  const onSort = (k: string) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

  const chartData = useMemo(() => {
    const days = eachDayOfInterval({ start: parseISO(range.start), end: parseISO(range.end) });
    if (days.length > 62) return [];
    const byDay = new Map<string, number>();
    for (const r of earnedRows) {
      const d = r.tourStartLa || '';
      byDay.set(d, (byDay.get(d) || 0) + (r.amazonPaid || 0));
    }
    return days.map((d) => {
      const key = format(d, 'yyyy-MM-dd');
      return { date: key, gross: Math.round((byDay.get(key) || 0) * 100) / 100 };
    });
  }, [earnedRows, range.start, range.end]);

  if (!driver) {
    return (
      <div>
        <Link to="/gross-by-driver" className="text-sm text-primary hover:underline">← Gross by Driver</Link>
        <p className="mt-4 text-text-secondary">Driver not found.</p>
      </div>
    );
  }
  const name = getDriverFullName(driver.firstName, driver.lastName);

  const exportCsv = () =>
    downloadCSV(
      `gross-${driver.driverId || name}-${range.start}_${range.end}.csv`,
      ['Tour', 'Status', 'Tour start', 'Pickup', 'Delivery', 'Miles', 'Amazon $', 'Week', 'Relay driver'],
      sorted.map((r) => [
        r.t.tripDisplay,
        STAGE_LABEL[r.stage],
        r.t.tourStartLa || '',
        r.t.puLocation,
        r.t.delLocation,
        r.t.mile,
        r.t.amazonPaid,
        r.t.weekLabel,
        r.t.driverNameRaw || '',
      ]),
    );

  const saveAdjustment = () => {
    if (!adjAmount || !adjReason) return;
    addGrossAdjustment({ driverId: id, amount: Number(adjAmount), reason: adjReason, date: range.start });
    setAdjOpen(false);
    setAdjAmount('');
    setAdjReason('');
  };

  return (
    <div>
      <Link to="/gross-by-driver" className="mb-2 inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> Gross by Driver
      </Link>
      <PageHeader
        title={name}
        subtitle={`${driver.driverId || ''} · gross and tours · Amazon tour price (not per-leg amounts)`}
        badge={<Badge status={driver.status} />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setAdjOpen(true)}>
              <Plus className="h-4 w-4" /> Gross adjustment
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-4 w-4" /> Export
            </Button>
            <Link to={`/drivers/${driver.id}`} className="self-center text-xs text-secondary hover:underline">
              Driver profile →
            </Link>
          </>
        }
      />

      <Card className="mb-5 p-4">
        <PeriodPicker value={period} onChange={setPeriod} />
      </Card>

      <div className="mb-5 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(12rem,1fr))]">
        <KpiCard
          title="Earned · period"
          value={earned}
          highlight
          subtitle={`${formatDate(range.start, 'MMM d')} – ${formatDate(range.end, 'MMM d')}`}
        />
        <KpiCard title="This week" value={earnedIn(week.start, week.end)} accent="info" />
        <KpiCard title="This month" value={earnedIn(month.start, month.end)} accent="primary" />
        <KpiCard title="Tours done" value={earnedRows.length} format="number" accent="success" />
        <KpiCard
          title="Avg / tour"
          value={earnedRows.length ? sumAmazonPaid(earnedRows) / earnedRows.length : 0}
          accent="success"
        />
        <KpiCard
          title="In progress"
          value={sumAmazonPaid(inProgressRows)}
          accent="warning"
          subtitle={`${inProgressRows.length} tours not finished`}
        />
        <KpiCard title="Charges" value={charges} accent="warning" subtitle={`Net ${formatCurrency(earned - charges)}`} />
      </div>

      {chartData.length > 0 && (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>Daily earned (by tour start)</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="date" tickFormatter={(v) => format(parseISO(v), 'MMM d')} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v ?? 0))} labelFormatter={(l) => formatDate(String(l))} />
                <Bar dataKey="gross" fill="#2878D0" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-clip">
        <CardHeader>
          <CardTitle>Tours ({sorted.length})</CardTitle>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
            Show cancelled with no pay
          </label>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border bg-bg/80">
                <SortHeader label="Tour" sortKey="tour" currentKey={sortKey} direction={sortDir} onSort={onSort} />
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Status</th>
                <SortHeader label="Tour start" sortKey="start" currentKey={sortKey} direction={sortDir} onSort={onSort} />
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Route</th>
                <SortHeader label="Miles" sortKey="miles" currentKey={sortKey} direction={sortDir} onSort={onSort} align="right" />
                <SortHeader label="Amazon $" sortKey="pay" currentKey={sortKey} direction={sortDir} onSort={onSort} align="right" />
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Week</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ t, stage }) => (
                <tr key={t.tripUuid || t.tripId} className="border-b border-border/60 table-row-hover">
                  <td className="px-3 py-2.5">
                    <Link to={`/loads?q=${encodeURIComponent(t.tripDisplay)}`} className="font-medium text-primary hover:underline">
                      {t.tripDisplay}
                    </Link>
                    {t.legCount > 1 && <span className="ml-1 text-xs text-text-secondary">{t.legCount} legs</span>}
                    {t.driverNameRaw && t.driverNameRaw.toLowerCase() !== name.toLowerCase() && (
                      <span className="block text-[11px] text-text-secondary">Relay: {t.driverNameRaw}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium', STAGE_CLASS[stage])}>
                      {STAGE_LABEL[stage]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                    {t.tourStartLa ? formatDate(t.tourStartLa, 'EEE, MMM d') : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {t.puLocation || '—'} → {t.delLocation || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{t.mile || '—'}</td>
                  <td className={cn('px-3 py-2.5 text-right font-semibold tabular-nums', stage === 'in_progress' && 'text-text-secondary')}>
                    {t.amazonPaid > 0 ? formatCurrency(t.amazonPaid) : <span className="text-xs font-normal text-text-secondary">No price yet</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs">{t.weekLabel}</td>
                </tr>
              ))}
              {periodAdjustments.map((a) => (
                <tr key={a.id} className="border-b border-border/60 bg-bg/40">
                  <td className="px-3 py-2.5 text-xs font-medium" colSpan={5}>
                    Adjustment · {a.reason} <span className="text-text-secondary">({formatDate(a.date, 'MMM d')})</span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatCurrency(a.amount)}</td>
                  <td />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-primary/5 font-semibold">
                <td className="px-3 py-3" colSpan={5}>Earned ({earnedRows.length} tours done{periodAdjustments.length ? ' + adjustments' : ''})</td>
                <td className="px-3 py-3 text-right tabular-nums text-primary">{formatCurrency(earned)}</td>
                <td />
              </tr>
              {inProgressRows.length > 0 && (
                <tr className="text-text-secondary">
                  <td className="px-3 py-2" colSpan={5}>In progress ({inProgressRows.length} tours, not counted yet)</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sumAmazonPaid(inProgressRows))}</td>
                  <td />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </Card>

      <Modal
        open={adjOpen}
        onClose={() => setAdjOpen(false)}
        title={`Gross adjustment · ${name}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setAdjOpen(false)}>Cancel</Button>
            <Button onClick={saveAdjustment}>Add adjustment</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Amount (negative for a deduction)">
            <Input type="number" step="0.01" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
          </Field>
          <Field label="Reason">
            <Textarea value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="e.g. Detention pay, claim adjustment…" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
