import { useMemo, useState } from 'react';
import { Download, Pencil, RefreshCw } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select } from '@/components/ui/Input';
import { downloadCSV, formatCurrency } from '@/lib/utils';
import {
  amazonWeekRangeFromAnchor,
  laTodayISO,
  shiftAmazonWeek,
} from '@/lib/amazonWeek';
import {
  adjustmentInvoicesForWeek,
  filterReportLoadsByWeek,
  filterWeekExpected,
  filterWeekIncome,
  filterWeekPendingInvoice,
  groupReportLoadsByWeekLabel,
  sumAmazonPaid,
  sumDriverPaid,
  sumWeekIncomeReconciled,
  type ReportLoadRow,
  type ReportSortKey,
} from '@/lib/reportLoadMoney';
import { computeRpm, formatSheetDate } from '@/lib/reportRows';
import { toast } from 'sonner';

/** Excel + screen columns (exact sheet headers). */
const REPORT_HEADERS = [
  'Broker',
  'Trip',
  'Load',
  'Driver',
  'Pick up',
  'Delivery',
  'PU',
  'Del',
  'Mile',
  'Amazon Paid',
  'Driver Paid',
  'RPM',
  'Comment',
  'Dispatch',
] as const;

const SORTABLE: Partial<Record<(typeof REPORT_HEADERS)[number], ReportSortKey>> = {
  Trip: 'trip',
  Load: 'load',
  Driver: 'driver',
  'Pick up': 'pickup',
  Delivery: 'delivery',
  Mile: 'mile',
  'Amazon Paid': 'amazon',
  'Driver Paid': 'driverPaid',
  Dispatch: 'dispatch',
};

type EditForm = {
  tourId: string;
  tripDisplay: string;
  driverName: string;
  driverPaid: string;
  comment: string;
  dispatch: string;
  mile: string;
};

function rowToCsv(r: ReportLoadRow): (string | number)[] {
  return [
    r.broker,
    r.tripDisplay,
    r.loadIds,
    r.driverName,
    formatSheetDate(r.pickupDate),
    formatSheetDate(r.deliveryDate),
    r.puLocation,
    r.delLocation,
    r.mile,
    r.amazonPaid,
    r.driverPaid,
    r.rpm || computeRpm(r.amazonPaid, r.mile) || '',
    r.comment || r.weekLabel,
    r.dispatch,
  ];
}

export function ReportsPage() {
  const {
    reportLoads,
    drivers,
    invoices,
    invoiceTrips,
    refreshData,
    upsertLoadOverride,
    dataReady,
  } = useData();

  const today = laTodayISO();
  const [weekAnchor, setWeekAnchor] = useState(today);
  const week = amazonWeekRangeFromAnchor(weekAnchor);

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sortKey, setSortKey] = useState<ReportSortKey>('week');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const dispatchOptions = useMemo(() => {
    const set = new Set<string>(['Khalid', 'David', 'Connor']);
    for (const r of reportLoads) {
      if (r.dispatch.trim()) set.add(r.dispatch.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [reportLoads]);

  const rowsInRange = useMemo(() => {
    // One row per tour; drop $0 payout rows (legacy leg noise).
    return filterReportLoadsByWeek(reportLoads, week.start, week.end).filter(
      (r) => r.amazonPaid > 0,
    );
  }, [reportLoads, week.end, week.start]);

  const incomeRows = useMemo(() => filterWeekIncome(rowsInRange), [rowsInRange]);
  const expectedRows = useMemo(() => filterWeekExpected(rowsInRange), [rowsInRange]);
  const pendingRows = useMemo(() => filterWeekPendingInvoice(rowsInRange), [rowsInRange]);
  const adjInvoices = useMemo(
    () => adjustmentInvoicesForWeek(invoices, week.start, week.end),
    [invoices, week.end, week.start],
  );
  const reconciled = useMemo(
    () => sumWeekIncomeReconciled(rowsInRange, invoices, week.start, week.end, invoiceTrips),
    [invoiceTrips, invoices, rowsInRange, week.end, week.start],
  );

  const groups = useMemo(
    () => groupReportLoadsByWeekLabel(incomeRows, sortKey, sortDir),
    [incomeRows, sortDir, sortKey],
  );

  // Week income = SUM of trip payouts only (never invoice amounts).
  const amazonTotal = reconciled.income;
  const driverTotal = sumDriverPaid(incomeRows);
  const estimatedCount = pendingRows.length;
  const invoiceWeekCount = reconciled.incomeTripCount;
  const paidCount = incomeRows.filter((r) => /paid/i.test(r.paidStatus)).length;
  const pendingCount = incomeRows.filter((r) => /pend/i.test(r.paidStatus)).length;

  const toggleSort = (key: ReportSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(key);
      setSortDir(key === 'week' || key === 'pickup' || key === 'delivery' ? 'desc' : 'asc');
    }
  };

  const openEdit = (r: ReportLoadRow) => {
    setForm({
      tourId: r.tourId,
      tripDisplay: r.tripDisplay,
      driverName: r.driverName,
      driverPaid: String(r.driverPaid ?? ''),
      comment: r.comment,
      dispatch: r.dispatch,
      mile: r.mile,
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!form) return;
    await upsertLoadOverride(form.tourId, {
      driverName: form.driverName.trim() || null,
      driverPaid: form.driverPaid === '' ? null : Number(form.driverPaid) || 0,
      comment: form.comment,
      dispatch: form.dispatch,
      mile: form.mile.trim() || null,
    });
    setEditOpen(false);
  };

  const exportCSV = () => {
    downloadCSV(
      `reports-${week.label}-${week.start}.csv`,
      [...REPORT_HEADERS],
      incomeRows.map(rowToCsv),
    );
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshData();
      toast.success('Refreshed report_loads');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle={`${week.header} · income = Σ trip payouts (completed/TONU on MAIN) · invoices comparison-only · one row per tour`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={!incomeRows.length}>
              <Download className="h-4 w-4" /> Export
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => setWeekAnchor(shiftAmazonWeek(week.start, -1))}
        >
          Prev week
        </Button>
        <span className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium tabular-nums">
          {week.header}
        </span>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => setWeekAnchor(shiftAmazonWeek(week.start, 1))}
        >
          Next week
        </Button>
        <Button variant="outline" size="sm" type="button" onClick={() => setWeekAnchor(today)}>
          This week
        </Button>
        <span className="ml-2 text-xs text-text-secondary">
          {drivers.length} drivers · legacy load_reports sync disabled
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Income trips" value={String(invoiceWeekCount)} />
        <Stat label="Week income (Σ payouts)" value={formatCurrency(amazonTotal)} />
        <Stat label="Driver Paid" value={formatCurrency(driverTotal)} />
        <Stat label="Adj invoices (compare)" value={formatCurrency(reconciled.adjustments)} />
        <Stat label="Pending invoice" value={`${estimatedCount} · ${formatCurrency(reconciled.pending)}`} />
        <Stat
          label="Paid status"
          value={
            paidCount || pendingCount
              ? `${paidCount} Paid · ${pendingCount} Pending`
              : '—'
          }
        />
      </div>

      {(adjInvoices.length > 0 || expectedRows.length > 0 || pendingRows.length > 0) && (
        <div className="mb-4 rounded-xl border border-border bg-white px-4 py-3 text-sm space-y-1">
          {adjInvoices.map((inv) => (
            <p key={inv.invoiceId}>
              <span className="font-medium">Adj invoice (comparison only)</span>{' '}
              {inv.invoiceId.slice(0, 12)}… {formatCurrency(inv.amount)} · {inv.status} — not in
              week income
            </p>
          ))}
          {pendingRows.length > 0 && (
            <p className="text-text-secondary">
              Pending invoice (completed/TONU, estimated by final delivery): {pendingRows.length}{' '}
              tours · {formatCurrency(sumAmazonPaid(pendingRows))} — excluded from week income
            </p>
          )}
          {expectedRows.filter((r) => r.amazonPaid > 0).length > 0 && (
            <p className="text-text-secondary">
              Expected (in-transit/upcoming):{' '}
              {expectedRows.filter((r) => r.amazonPaid > 0).length} tours ·{' '}
              {formatCurrency(sumAmazonPaid(expectedRows))} — separate from income
            </p>
          )}
        </div>
      )}

      {!dataReady ? (
        <EmptyState title="Loading…" description="Hydrating report_loads" />
      ) : incomeRows.length === 0 ? (
        <EmptyState
          title="No income tours this Amazon week"
          description="Week income = completed/TONU on MAIN invoice. Expected and pending-invoice tours are listed above when present."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-border bg-bg/80">
                  {REPORT_HEADERS.map((h) => {
                    const key = SORTABLE[h];
                    const active = key && sortKey === key;
                    return (
                      <th
                        key={h}
                        className="whitespace-nowrap px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-text-secondary"
                      >
                        {key ? (
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1 hover:text-text ${active ? 'text-text' : ''}`}
                            onClick={() => toggleSort(key)}
                          >
                            {h}
                            {active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                          </button>
                        ) : (
                          h
                        )}
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 text-[10px] font-semibold uppercase text-text-secondary">
                    Paid
                  </th>
                  <th className="px-2 py-2 text-[10px] font-semibold uppercase text-text-secondary">
                    Edit
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g.week} week={g.week} rows={g.rows} onEdit={openEdit} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={editOpen && !!form}
        onClose={() => setEditOpen(false)}
        title={form ? `Manual override ${form.tripDisplay}` : 'Manual override'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()}>Save manual</Button>
          </>
        }
      >
        {form && (
          <div className="space-y-3">
            <p className="text-xs text-text-secondary">
              Saves to load_overrides with source=manual only. Amazon $, PU/Del, and dates stay live
              from Relay. Migrated seed rows are not editable overrides.
            </p>
            <Field label="Driver">
              <Input
                value={form.driverName}
                onChange={(e) => setForm({ ...form, driverName: e.target.value })}
              />
            </Field>
            <Field label="Driver Paid">
              <Input
                type="number"
                step="0.01"
                value={form.driverPaid}
                onChange={(e) => setForm({ ...form, driverPaid: e.target.value })}
              />
            </Field>
            <Field label="Mile">
              <Input
                value={form.mile}
                onChange={(e) => setForm({ ...form, mile: e.target.value })}
              />
            </Field>
            <Field label="Comment">
              <Input
                value={form.comment}
                onChange={(e) => setForm({ ...form, comment: e.target.value })}
              />
            </Field>
            <Field label="Dispatch">
              <Select
                value={form.dispatch}
                onChange={(e) => setForm({ ...form, dispatch: e.target.value })}
              >
                <option value="">—</option>
                {dispatchOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function GroupRows({
  week,
  rows,
  onEdit,
}: {
  week: string;
  rows: ReportLoadRow[];
  onEdit: (r: ReportLoadRow) => void;
}) {
  return (
    <>
      <tr className="bg-sky-50/80">
        <td colSpan={16} className="px-3 py-1.5 text-xs font-bold text-sky-800">
          {week} · {rows.length} tours · Amazon {formatCurrency(sumAmazonPaid(rows))}
          {rows[0]?.weekStart && rows[0]?.weekEnd
            ? ` · ${rows[0].weekStart} → ${rows[0].weekEnd}`
            : ''}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.tourId} className="table-row-hover border-b border-border/60">
          <td className="whitespace-nowrap px-2 py-1.5">{r.broker}</td>
          <td className="whitespace-nowrap px-2 py-1.5 font-medium text-primary">{r.tripDisplay}</td>
          <td className="max-w-[140px] truncate px-2 py-1.5 text-xs tabular-nums" title={r.loadIds}>
            {r.loadIds}
          </td>
          <td className="whitespace-nowrap px-2 py-1.5">{r.driverName || '—'}</td>
          <td className="whitespace-nowrap px-2 py-1.5 text-xs">{formatSheetDate(r.pickupDate)}</td>
          <td className="whitespace-nowrap px-2 py-1.5 text-xs">{formatSheetDate(r.deliveryDate)}</td>
          <td className="max-w-[120px] truncate px-2 py-1.5 text-xs" title={r.puLocation}>
            {r.puLocation || '—'}
          </td>
          <td className="max-w-[120px] truncate px-2 py-1.5 text-xs" title={r.delLocation}>
            {r.delLocation || '—'}
          </td>
          <td className="px-2 py-1.5 text-xs tabular-nums">{r.mile || '—'}</td>
          <td className="px-2 py-1.5 text-right font-medium tabular-nums">
            {formatCurrency(r.amazonPaid)}
          </td>
          <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.driverPaid)}</td>
          <td className="px-2 py-1.5 text-right text-xs tabular-nums">
            {r.rpm || computeRpm(r.amazonPaid, r.mile) || '—'}
          </td>
          <td
            className="max-w-[140px] truncate px-2 py-1.5 text-xs"
            title={
              r.estimatedWeek
                ? `Estimated week from pickup (${r.weekLabel})`
                : `Invoice week ${r.weekLabel}${r.invoiceId ? ` · ${r.invoiceId}` : ''}`
            }
          >
            {r.comment || r.weekLabel}
            {r.estimatedWeek ? (
              <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800">
                est
              </span>
            ) : (
              <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-semibold text-emerald-800">
                inv
              </span>
            )}
          </td>
          <td className="px-2 py-1.5 text-xs">{r.dispatch || '—'}</td>
          <td className="whitespace-nowrap px-2 py-1.5 text-xs">
            {r.paidStatus ? (
              <span
                className={
                  /paid/i.test(r.paidStatus)
                    ? 'rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800'
                    : 'rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800'
                }
              >
                {r.paidStatus}
              </span>
            ) : (
              '—'
            )}
          </td>
          <td className="px-2 py-1.5">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              title={r.hasOverride ? 'Edit manual override' : 'Add manual override'}
              onClick={() => onEdit(r)}
            >
              <Pencil
                className={`h-3.5 w-3.5 ${r.hasOverride ? 'text-primary' : 'text-text-secondary'}`}
              />
            </Button>
          </td>
        </tr>
      ))}
    </>
  );
}
