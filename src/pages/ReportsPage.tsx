import { memo, useMemo, useState } from 'react';
import { Download, Pencil, RefreshCw } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select } from '@/components/ui/Input';
import { KpiSkeletonRow, TableSkeleton } from '@/components/ui/Skeleton';
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
  moneyBucketLabel,
  sortReportLoads,
  sumAmazonPaid,
  sumDriverPaid,
  sumWeekIncomeReconciled,
  type ReportLoadRow,
  type ReportSortKey,
} from '@/lib/reportLoadMoney';
import { computeRpm, formatSheetDate } from '@/lib/reportRows';
import { toast } from 'sonner';
import type { LoadReport } from '@/types';

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
    ...rowToSheet(r),
    moneyBucketLabel(r),
  ];
}

function rowToSheet(r: ReportLoadRow): (string | number)[] {
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
    loadReports,
    drivers,
    invoices,
    invoiceTrips,
    refreshData,
    upsertLoadOverride,
    dataReady,
    dataError,
    dataFetching,
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
  const pendingSorted = useMemo(
    () => sortReportLoads(pendingRows, sortKey, sortDir),
    [pendingRows, sortDir, sortKey],
  );
  const expectedSorted = useMemo(
    () => sortReportLoads(expectedRows, sortKey, sortDir),
    [expectedRows, sortDir, sortKey],
  );
  // Manual rows (non-Relay loads added via Quick Add → Manual). Shown, not counted in Relay totals.
  const manualRows = useMemo(
    () =>
      loadReports.filter((r) => {
        if (r.source !== 'manual') return false;
        const d = (r.pickupDate || r.deliveryDate || '').slice(0, 10);
        return Boolean(d) && d >= week.start && d <= week.end;
      }),
    [loadReports, week.end, week.start],
  );

  // Week income = SUM of trip payouts only (never invoice amounts).
  const amazonTotal = reconciled.income;
  const pendingTotal = sumAmazonPaid(pendingRows);
  const expectedTotal = sumAmazonPaid(expectedRows);
  const driverTotal = sumDriverPaid([...incomeRows, ...pendingRows]);
  const invoiceWeekCount = reconciled.incomeTripCount;
  const anyRows =
    incomeRows.length + pendingRows.length + expectedRows.length + manualRows.length > 0;
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
      [...REPORT_HEADERS, 'Status'],
      [
        ...sortReportLoads(incomeRows, sortKey, sortDir).map(rowToCsv),
        ...pendingSorted.map(rowToCsv),
        ...expectedSorted.map(rowToCsv),
        ...manualRows.map((m) => [...manualToSheet(m), 'Manual (not from Relay)']),
      ],
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
        subtitle={`${week.header} · one row per tour · income is confirmed when Amazon's weekly invoice arrives (usually Mon–Tue after the week ends)`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={!anyRows}>
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

      {!dataReady ? (
        <div className="mb-4">
          <KpiSkeletonRow n={6} />
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
          <Stat
            label="Invoiced income"
            value={formatCurrency(amazonTotal)}
            hint={`${invoiceWeekCount} trips on Amazon's invoice`}
          />
          <Stat
            label="Completed · awaiting invoice"
            value={formatCurrency(pendingTotal)}
            hint={`${pendingRows.length} trips delivered, not invoiced yet`}
          />
          <Stat
            label="Week total so far"
            value={formatCurrency(amazonTotal + pendingTotal)}
            hint="Invoiced + awaiting invoice"
          />
          <Stat
            label="In progress"
            value={formatCurrency(expectedTotal)}
            hint={`${expectedRows.length} trips not delivered yet`}
          />
          <Stat
            label="Driver paid"
            value={formatCurrency(driverTotal)}
            hint="Invoiced + awaiting invoice"
          />
          <Stat
            label="Paid status"
            value={
              paidCount || pendingCount
                ? `${paidCount} Paid · ${pendingCount} Pending`
                : '—'
            }
          />
        </div>
      )}

      {dataError && dataReady && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm">
          <span>Could not refresh data: {dataError}</span>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      )}
      {dataFetching && dataReady && (
        <p className="mb-2 text-xs text-text-secondary">Updating in background…</p>
      )}

      {adjInvoices.length > 0 && (
        <div className="mb-4 space-y-1 rounded-xl border border-border bg-white px-4 py-3 text-sm">
          {adjInvoices.map((inv) => (
            <p key={inv.invoiceId}>
              <span className="font-medium">Adjustment invoice (comparison only)</span>{' '}
              {inv.invoiceId.slice(0, 12)}… {formatCurrency(inv.amount)} · {inv.status} — not in
              week income
            </p>
          ))}
        </div>
      )}

      {!dataReady ? (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <TableSkeleton rows={12} cols={8} />
        </div>
      ) : !anyRows ? (
        <EmptyState
          title="No trips this Amazon week"
          description="Nothing delivered, in progress or invoiced for this Sunday–Saturday week."
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
                {incomeRows.length > 0 && (
                  <SectionRow
                    tone="income"
                    title="Invoiced by Amazon"
                    rows={incomeRows}
                    note="Confirmed income"
                  />
                )}
                {groups.map((g) => (
                  <GroupRows key={g.week} week={g.week} rows={g.rows} onEdit={openEdit} />
                ))}
                {pendingSorted.length > 0 && (
                  <>
                    <SectionRow
                      tone="pending"
                      title="Completed — waiting for Amazon's invoice"
                      rows={pendingSorted}
                      note="Week is estimated from delivery date until the invoice confirms it"
                    />
                    {pendingSorted.map((r) => (
                      <ReportLoadRowView key={r.tourId} r={r} onEdit={openEdit} />
                    ))}
                  </>
                )}
                {expectedSorted.length > 0 && (
                  <>
                    <SectionRow
                      tone="expected"
                      title="In progress — not delivered yet"
                      rows={expectedSorted}
                      note="Not income yet"
                    />
                    {expectedSorted.map((r) => (
                      <ReportLoadRowView key={r.tourId} r={r} onEdit={openEdit} />
                    ))}
                  </>
                )}
                {manualRows.length > 0 && (
                  <>
                    <tr className="bg-slate-100">
                      <td colSpan={16} className="px-3 py-1.5 text-xs font-bold text-slate-700">
                        Manual rows (not from Relay) · {manualRows.length} ·{' '}
                        {formatCurrency(manualRows.reduce((s, m) => s + (Number(m.amazonPaid) || 0), 0))}
                        <span className="ml-2 font-normal text-slate-500">not counted in the totals above</span>
                      </td>
                    </tr>
                    {manualRows.map((m) => (
                      <tr key={m.id} className="border-b border-border/60 text-slate-700">
                        {manualToSheet(m).map((v, i) => (
                          <td key={i} className="whitespace-nowrap px-2 py-1.5 text-xs">
                            {typeof v === 'number' && (i === 9 || i === 10) ? formatCurrency(v) : String(v || '—')}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-xs">Manual</td>
                        <td />
                      </tr>
                    ))}
                  </>
                )}
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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-text-secondary">{hint}</p>}
    </div>
  );
}

function manualToSheet(m: LoadReport): (string | number)[] {
  return [
    m.broker,
    m.trip,
    m.loadIds,
    m.driverName,
    formatSheetDate(m.pickupDate),
    formatSheetDate(m.deliveryDate),
    m.puLocation,
    m.delLocation,
    m.mile,
    m.amazonPaid,
    m.driverPaid,
    m.rpm || computeRpm(m.amazonPaid, m.mile) || '',
    m.comment,
    m.dispatch,
  ];
}

const SECTION_TONE = {
  income: 'bg-emerald-50 text-emerald-800',
  pending: 'bg-amber-50 text-amber-900',
  expected: 'bg-blue-50 text-blue-800',
} as const;

function SectionRow({
  tone,
  title,
  rows,
  note,
}: {
  tone: keyof typeof SECTION_TONE;
  title: string;
  rows: ReportLoadRow[];
  note: string;
}) {
  return (
    <tr className={SECTION_TONE[tone]}>
      <td colSpan={16} className="px-3 py-2 text-xs font-bold">
        {title} · {rows.length} trips · {formatCurrency(sumAmazonPaid(rows))}
        <span className="ml-2 font-normal opacity-80">{note}</span>
      </td>
    </tr>
  );
}

const GroupRows = memo(function GroupRows({
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
        <ReportLoadRowView key={r.tourId} r={r} onEdit={onEdit} />
      ))}
    </>
  );
});

const ReportLoadRowView = memo(function ReportLoadRowView({
  r,
  onEdit,
}: {
  r: ReportLoadRow;
  onEdit: (r: ReportLoadRow) => void;
}) {
  return (
        <tr className="table-row-hover border-b border-border/60">
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
                ? `Estimated week from delivery date (${r.weekLabel}); confirmed when the invoice arrives`
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
            {r.moneyBucket === 'pending_invoice' ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                Awaiting invoice
              </span>
            ) : r.moneyBucket === 'expected' ? (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-800">
                In progress
              </span>
            ) : r.paidStatus ? (
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
  );
});
