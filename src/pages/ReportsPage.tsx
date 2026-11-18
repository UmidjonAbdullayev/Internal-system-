import { useMemo, useState } from 'react';
import { Download, Pencil, RefreshCw } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select } from '@/components/ui/Input';
import {
  downloadCSV,
  formatCurrency,
  formatDate,
} from '@/lib/utils';
import {
  amazonWeekRangeFromAnchor,
  laTodayISO,
  shiftAmazonWeek,
} from '@/lib/amazonWeek';
import {
  filterReportLoadsByWeek,
  groupReportLoadsByWeekLabel,
  sumAmazonPaid,
  sumDriverPaid,
  type ReportLoadRow,
} from '@/lib/reportLoadMoney';
import { computeRpm, formatSheetDate } from '@/lib/reportRows';
import { toast } from 'sonner';

const REPORT_HEADERS = [
  'Broker',
  'Trip',
  'Load',
  'Driver name',
  'Pick up',
  'Delivery',
  'PU location',
  'Del location',
  'Mile',
  'Amazon Paid',
  'Driver Paid',
  'RPM',
  'Comment',
  'Dispatch',
] as const;

type EditForm = {
  tourId: string;
  tripDisplay: string;
  driverName: string;
  driverPaid: string;
  comment: string;
  dispatch: string;
  mile: string;
};

export function ReportsPage() {
  const {
    reportLoads,
    drivers,
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

  const dispatchOptions = useMemo(() => {
    const set = new Set<string>(['Khalid', 'David', 'Connor']);
    for (const r of reportLoads) {
      if (r.dispatch.trim()) set.add(r.dispatch.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [reportLoads]);

  const rowsInRange = useMemo(
    () => filterReportLoadsByWeek(reportLoads, week.start, week.end),
    [reportLoads, week.end, week.start],
  );

  const groups = useMemo(() => groupReportLoadsByWeekLabel(rowsInRange), [rowsInRange]);

  const amazonTotal = sumAmazonPaid(rowsInRange);
  const driverTotal = sumDriverPaid(rowsInRange);
  const estimatedCount = rowsInRange.filter((r) => r.estimatedWeek).length;
  const invoiceWeekCount = rowsInRange.length - estimatedCount;

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
      rowsInRange.map((r) => [
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
        r.rpm,
        r.comment || r.weekLabel,
        r.dispatch,
      ]),
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
        subtitle={`Ops sheet · ${week.label} · ${week.start} → ${week.end} (Sun–Sat LA) · MAIN invoice week when available, else estimated from pickup`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={!rowsInRange.length}>
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
          {week.label}: {formatDate(week.start, 'MMM d')} – {formatDate(week.end, 'MMM d, yyyy')}
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
        <span className="text-xs text-text-secondary ml-2">
          {drivers.length} drivers · filter = tour start LA only (not pickup OR delivery)
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Tours" value={String(rowsInRange.length)} />
        <Stat label="Amazon Paid" value={formatCurrency(amazonTotal)} />
        <Stat label="Driver Paid" value={formatCurrency(driverTotal)} />
        <Stat label="Invoice week" value={String(invoiceWeekCount)} />
        <Stat label="Estimated week" value={String(estimatedCount)} />
      </div>

      {!dataReady ? (
        <EmptyState title="Loading…" description="Hydrating report_loads" />
      ) : rowsInRange.length === 0 ? (
        <EmptyState
          title="No tours this Amazon week"
          description="One row per Relay tour. Week = first pickup (tour start) in America/Los_Angeles, Sunday–Saturday."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="border-b border-border bg-bg/80">
                  {REPORT_HEADERS.map((h) => (
                    <th
                      key={h}
                      className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-text-secondary whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-[10px] font-semibold uppercase text-text-secondary">Edit</th>
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
        title={form ? `Override ${form.tripDisplay}` : 'Override'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()}>Save override</Button>
          </>
        }
      >
        {form && (
          <div className="space-y-3">
            <p className="text-xs text-text-secondary">
              Amazon $, PU/Del, and dates come live from Relay. Only driver name / paid / comment /
              dispatch / mile are stored in load_overrides.
            </p>
            <Field label="Driver name">
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
        <td colSpan={15} className="px-3 py-1.5 text-xs font-bold text-sky-800">
          {week} · {rows.length} tours · Amazon {formatCurrency(sumAmazonPaid(rows))}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.tourId} className="border-b border-border/60 table-row-hover">
          <td className="px-2 py-1.5 whitespace-nowrap">{r.broker}</td>
          <td className="px-2 py-1.5 font-medium text-primary whitespace-nowrap">{r.tripDisplay}</td>
          <td className="px-2 py-1.5 text-xs tabular-nums max-w-[140px] truncate" title={r.loadIds}>
            {r.loadIds}
          </td>
          <td className="px-2 py-1.5 whitespace-nowrap">{r.driverName || '—'}</td>
          <td className="px-2 py-1.5 text-xs whitespace-nowrap">{formatSheetDate(r.pickupDate)}</td>
          <td className="px-2 py-1.5 text-xs whitespace-nowrap">{formatSheetDate(r.deliveryDate)}</td>
          <td className="px-2 py-1.5 text-xs max-w-[120px] truncate" title={r.puLocation}>
            {r.puLocation || '—'}
          </td>
          <td className="px-2 py-1.5 text-xs max-w-[120px] truncate" title={r.delLocation}>
            {r.delLocation || '—'}
          </td>
          <td className="px-2 py-1.5 text-xs tabular-nums">{r.mile || '—'}</td>
          <td className="px-2 py-1.5 text-right tabular-nums font-medium">
            {formatCurrency(r.amazonPaid)}
          </td>
          <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.driverPaid)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-xs">
            {r.rpm || computeRpm(r.amazonPaid, r.mile) || '—'}
          </td>
          <td
            className="px-2 py-1.5 text-xs max-w-[140px] truncate"
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
          <td className="px-2 py-1.5">
            <Button variant="ghost" size="sm" type="button" onClick={() => onEdit(r)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </td>
        </tr>
      ))}
    </>
  );
}
