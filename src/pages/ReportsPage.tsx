import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { DateRangeFilter } from '@/components/ui/DateRangeFilter';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Field, Input, Select } from '@/components/ui/Input';
import {
  downloadCSV,
  formatCurrency,
  getDateRangeFromPreset,
  todayISO,
} from '@/lib/utils';
import {
  computeRpm,
  formatSheetDate,
  groupReportsByWeek,
  reportInDateRange,
  sanitizeReportLocation,
  weekLabelFromDate,
} from '@/lib/reportRows';
import type { DatePreset, DateRange, LoadReport } from '@/types';
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

type ReportForm = {
  broker: string;
  trip: string;
  loadIds: string;
  driverName: string;
  pickupDate: string;
  deliveryDate: string;
  puLocation: string;
  delLocation: string;
  mile: string;
  amazonPaid: string;
  driverPaid: string;
  rpm: string;
  comment: string;
  dispatch: string;
};

const emptyForm = (): ReportForm => ({
  broker: 'Amazon',
  trip: '',
  loadIds: '',
  driverName: '',
  pickupDate: '',
  deliveryDate: '',
  puLocation: '',
  delLocation: '',
  mile: '',
  amazonPaid: '',
  driverPaid: '',
  rpm: '',
  comment: '',
  dispatch: '',
});

function formFromReport(r: LoadReport): ReportForm {
  return {
    broker: r.broker,
    trip: r.trip,
    loadIds: r.loadIds,
    driverName: r.driverName,
    pickupDate: r.pickupDate || '',
    deliveryDate: r.deliveryDate || '',
    puLocation: r.puLocation,
    delLocation: r.delLocation,
    mile: r.mile,
    amazonPaid: String(r.amazonPaid ?? ''),
    driverPaid: String(r.driverPaid ?? ''),
    rpm: String(r.rpm ?? ''),
    comment: r.comment,
    dispatch: r.dispatch,
  };
}

function formToPatch(form: ReportForm): Omit<LoadReport, 'id' | 'createdAt' | 'updatedAt' | 'loadUuid' | 'source'> {
  const amazonPaid = Number(form.amazonPaid) || 0;
  const driverPaid = Number(form.driverPaid) || 0;
  const mile = form.mile.trim();
  const rpmRaw = form.rpm.trim();
  const rpm = rpmRaw !== '' ? Number(rpmRaw) || 0 : computeRpm(amazonPaid, mile);
  return {
    broker: form.broker.trim() || 'Amazon',
    trip: form.trip.trim(),
    loadIds: form.loadIds.trim(),
    driverName: form.driverName.trim(),
    pickupDate: form.pickupDate || null,
    deliveryDate: form.deliveryDate || null,
    puLocation: form.puLocation.trim(),
    delLocation: form.delLocation.trim(),
    mile,
    amazonPaid,
    driverPaid,
    rpm,
    comment:
      form.comment.trim() ||
      weekLabelFromDate(form.pickupDate || form.deliveryDate),
    dispatch: form.dispatch.trim(),
  };
}

function GroupRows({
  week,
  rows,
  onEdit,
  onDelete,
}: {
  week: string;
  rows: LoadReport[];
  onEdit: (r: LoadReport) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <tr className="bg-secondary text-white">
        <td
          colSpan={REPORT_HEADERS.length + 1}
          className="px-2 py-1.5 text-xs font-semibold tracking-wide"
        >
          {week}
        </td>
      </tr>
      {rows.map((r) => (
        <tr
          key={r.id}
          className="border-b border-border/80 hover:bg-bg/80 odd:bg-white even:bg-slate-50/60"
        >
          <td className="border border-border/60 px-2 py-1.5 whitespace-nowrap">{r.broker}</td>
          <td className="border border-border/60 px-2 py-1.5 font-mono whitespace-nowrap">{r.trip}</td>
          <td className="border border-border/60 px-2 py-1.5 font-mono whitespace-nowrap">{r.loadIds}</td>
          <td className="border border-border/60 px-2 py-1.5 whitespace-nowrap">{r.driverName}</td>
          <td className="border border-border/60 px-2 py-1.5 text-center tabular-nums whitespace-nowrap">
            {formatSheetDate(r.pickupDate)}
          </td>
          <td className="border border-border/60 px-2 py-1.5 text-center tabular-nums whitespace-nowrap">
            {formatSheetDate(r.deliveryDate)}
          </td>
          <td className="border border-border/60 px-2 py-1.5 whitespace-nowrap">
            {sanitizeReportLocation(r.puLocation)}
          </td>
          <td className="border border-border/60 px-2 py-1.5 whitespace-nowrap">
            {sanitizeReportLocation(r.delLocation)}
          </td>
          <td className="border border-border/60 px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
            {r.mile}
          </td>
          <td className="border border-border/60 px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
            {formatCurrency(r.amazonPaid)}
          </td>
          <td className="border border-border/60 px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
            {formatCurrency(r.driverPaid)}
          </td>
          <td className="border border-border/60 px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
            {formatCurrency(r.rpm)}
          </td>
          <td className="border border-border/60 px-2 py-1.5 whitespace-nowrap">{r.comment}</td>
          <td className="border border-border/60 px-2 py-1.5 whitespace-nowrap">{r.dispatch}</td>
          <td className="border border-border/60 px-1.5 py-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white text-text-secondary hover:border-primary hover:text-primary"
                onClick={() => onEdit(r)}
                aria-label="Edit row"
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white text-text-secondary hover:border-danger hover:text-danger"
                onClick={() => onDelete(r.id)}
                aria-label="Delete row"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

function summaryInRange(
  endTime: string | null,
  startTime: string | null,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  const day = (endTime || startTime || '').slice(0, 10);
  if (!day) return false;
  return day >= rangeStart && day <= rangeEnd;
}

export function ReportsPage() {
  const {
    loads,
    loadReports,
    tripSummaries,
    drivers,
    companySettings,
    dataReady,
    addLoadReport,
    updateLoadReport,
    deleteLoadReport,
    syncLoadReportsForRange,
  } = useData();

  const tz = companySettings.timezone || 'America/Chicago';
  const today = todayISO(tz);
  const retentionDays = companySettings.historyRetentionDays || 45;
  const detailCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const [preset, setPreset] = useState<DatePreset>('this_week');
  const [customRange, setCustomRange] = useState<DateRange>(() =>
    getDateRangeFromPreset('this_week', undefined, today),
  );
  const range = getDateRangeFromPreset(preset, customRange, today);
  const rangeUsesSummaries = range.start < detailCutoff;

  const [syncing, setSyncing] = useState(false);
  const [didAutoSync, setDidAutoSync] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<LoadReport | null>(null);
  const [form, setForm] = useState<ReportForm>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const dispatchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of loadReports) {
      if (r.dispatch.trim()) set.add(r.dispatch.trim());
    }
    for (const name of ['Khalid', 'David', 'Connor']) set.add(name);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [loadReports]);

  const rowsInRange = useMemo(
    () =>
      loadReports.filter((r) =>
        reportInDateRange(r, range.start, range.end),
      ),
    [loadReports, range.end, range.start],
  );

  /** Older than retention: permanent trip_summaries (no address/phone). */
  const summaryRowsInRange = useMemo(() => {
    if (!rangeUsesSummaries) return [];
    return tripSummaries.filter((s) => {
      const day = (s.endTime || s.startTime || '').slice(0, 10);
      if (!day || day >= detailCutoff) return false;
      return summaryInRange(s.endTime, s.startTime, range.start, range.end);
    });
  }, [tripSummaries, range.start, range.end, rangeUsesSummaries, detailCutoff]);

  const groups = useMemo(() => groupReportsByWeek(rowsInRange), [rowsInRange]);

  // Auto-sync missing loads into reports once data is ready for this week view
  useEffect(() => {
    if (!dataReady || didAutoSync) return;
    setDidAutoSync(true);
    setSyncing(true);
    void syncLoadReportsForRange(range.start, range.end, { quiet: true }).finally(() =>
      setSyncing(false),
    );
    // only on first ready — user can Update manually afterward
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady]);

  const openCreate = () => {
    setEditing(null);
    const base = emptyForm();
    base.comment = weekLabelFromDate(range.start);
    setForm(base);
    setEditOpen(true);
  };

  const openEdit = (row: LoadReport) => {
    setEditing(row);
    setForm(formFromReport(row));
    setEditOpen(true);
  };

  const saveForm = () => {
    const patch = formToPatch(form);
    if (!patch.loadIds && !patch.trip) {
      toast.error('Load or Trip is required');
      return;
    }
    if (editing) {
      updateLoadReport(editing.id, patch);
    } else {
      addLoadReport({
        ...patch,
        loadUuid: null,
        source: 'manual',
      });
    }
    setEditOpen(false);
    setEditing(null);
  };

  const onAmazonOrMileChange = (next: Partial<ReportForm>) => {
    setForm((prev) => {
      const merged = { ...prev, ...next };
      const amazon = Number(merged.amazonPaid) || 0;
      if (next.amazonPaid != null || next.mile != null) {
        merged.rpm = String(computeRpm(amazon, merged.mile) || '');
        if (next.amazonPaid != null && !merged.driverPaid) {
          merged.driverPaid = merged.amazonPaid;
        }
      }
      return merged;
    });
  };

  const handleUpdate = async () => {
    setSyncing(true);
    try {
      await syncLoadReportsForRange(range.start, range.end);
    } finally {
      setSyncing(false);
    }
  };

  const handleDownload = () => {
    if (!rowsInRange.length) {
      toast.error('No rows in this range to download');
      return;
    }
    const sorted = groups.flatMap((g) => g.rows);
    downloadCSV(
      `ops-report_${range.start}_${range.end}.csv`,
      [...REPORT_HEADERS],
      sorted.map((r) => [
        r.broker,
        r.trip,
        r.loadIds,
        r.driverName,
        formatSheetDate(r.pickupDate),
        formatSheetDate(r.deliveryDate),
        sanitizeReportLocation(r.puLocation),
        sanitizeReportLocation(r.delLocation),
        r.mile,
        r.amazonPaid,
        r.driverPaid,
        r.rpm,
        r.comment,
        r.dispatch,
      ]),
    );
    toast.success('Report downloaded');
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle={`Ops sheet · ${range.start} → ${range.end} (${tz}) · detail ≤${retentionDays}d${
          rangeUsesSummaries ? ' · older from trip_summaries' : ''
        }`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleUpdate} disabled={syncing}>
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              Update
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4" />
              Download
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add row
            </Button>
          </div>
        }
      />

      <DateRangeFilter
        preset={preset}
        onPresetChange={setPreset}
        customRange={customRange}
        onCustomRangeChange={setCustomRange}
        className="mb-4"
      />

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
        <span>
          <strong className="text-text">{rowsInRange.length}</strong> rows
        </span>
        <span>·</span>
        <span>
          Amazon{' '}
          <strong className="text-text">
            {formatCurrency(rowsInRange.reduce((s, r) => s + r.amazonPaid, 0))}
          </strong>
        </span>
        <span>·</span>
        <span>
          Driver{' '}
          <strong className="text-text">
            {formatCurrency(rowsInRange.reduce((s, r) => s + r.driverPaid, 0))}
          </strong>
        </span>
        <span className="text-text-secondary/80">
          · {drivers.length} drivers synced
        </span>
      </div>

      {rangeUsesSummaries && summaryRowsInRange.length > 0 ? (
        <div className="mb-6 overflow-x-auto rounded-lg border border-border">
          <div className="border-b border-border bg-bg/80 px-3 py-2 text-xs font-semibold uppercase text-text-secondary">
            Archived trip summaries (older than {retentionDays}d · no address/phone)
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-text-secondary">
                <th className="px-3 py-2">Trip</th>
                <th className="px-3 py-2">Driver</th>
                <th className="px-3 py-2">Route</th>
                <th className="px-3 py-2">End</th>
                <th className="px-3 py-2 text-right">Miles</th>
                <th className="px-3 py-2 text-right">Pay</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {summaryRowsInRange.map((s) => (
                <tr key={s.id} className="border-b border-border/60">
                  <td className="px-3 py-2 font-medium text-primary">{s.tripId}</td>
                  <td className="px-3 py-2">{s.driverName || '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {(s.facilityCodes || []).filter(Boolean).join(' → ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {(s.endTime || s.startTime || '').slice(0, 10) || '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.totalMiles ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {formatCurrency(Number(s.payout) || 0)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {s.status || s.executionStatus || '—'}
                    {s.wasLate ? ' · late' : ''}
                    {s.needsReview ? ' · review' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!rowsInRange.length ? (
        <EmptyState
          title="No report rows for this range"
          description={
            summaryRowsInRange.length > 0
              ? `${summaryRowsInRange.length} archived trip summar${summaryRowsInRange.length === 1 ? 'y' : 'ies'} shown above for dates older than ${retentionDays} days.`
              : loadReports.length > 0
                ? `${loadReports.length} report row(s) exist outside this week’s filter — widen the date preset or click Sync from loads.`
                : loads.length > 0
                  ? `${loads.length} synced load(s) in CRM — click Sync from loads to pull this week into Reports.`
                  : 'Use Update to pull synced Relay tours, or Quick Add / Add row to create entries.'
          }
          actionLabel={syncing ? 'Syncing…' : 'Sync from loads'}
          onAction={() => {
            if (!syncing) void handleUpdate();
          }}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-white shadow-sm">
          <table className="min-w-[1200px] w-full border-collapse text-[11px] leading-tight">
            <thead>
              <tr className="bg-primary text-white">
                {REPORT_HEADERS.map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap border border-primary-dark/40 px-2 py-2 text-left font-semibold"
                  >
                    {h}
                  </th>
                ))}
                <th className="whitespace-nowrap border border-primary-dark/40 px-2 py-2 text-left font-semibold w-20">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <GroupRows
                  key={`week-${group.week}-${group.rows[0]?.id ?? 'x'}`}
                  week={group.week}
                  rows={group.rows}
                  onEdit={openEdit}
                  onDelete={setDeleteId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={editing ? 'Edit report row' : 'Add report row'}
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveForm}>{editing ? 'Save' : 'Add'}</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Broker">
            <Input
              value={form.broker}
              onChange={(e) => setForm({ ...form, broker: e.target.value })}
            />
          </Field>
          <Field label="Trip">
            <Input
              value={form.trip}
              onChange={(e) => setForm({ ...form, trip: e.target.value })}
              placeholder="T-…"
            />
          </Field>
          <Field label="Load">
            <Input
              value={form.loadIds}
              onChange={(e) => setForm({ ...form, loadIds: e.target.value })}
            />
          </Field>
          <Field label="Driver name">
            <Input
              value={form.driverName}
              onChange={(e) => setForm({ ...form, driverName: e.target.value })}
            />
          </Field>
          <Field label="Pick up">
            <Input
              type="date"
              value={form.pickupDate}
              onChange={(e) => setForm({ ...form, pickupDate: e.target.value })}
            />
          </Field>
          <Field label="Delivery">
            <Input
              type="date"
              value={form.deliveryDate}
              onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })}
            />
          </Field>
          <Field label="PU location">
            <Input
              value={form.puLocation}
              onChange={(e) => setForm({ ...form, puLocation: e.target.value })}
            />
          </Field>
          <Field label="Del location">
            <Input
              value={form.delLocation}
              onChange={(e) => setForm({ ...form, delLocation: e.target.value })}
            />
          </Field>
          <Field label="Mile (or TONU)">
            <Input
              value={form.mile}
              onChange={(e) => onAmazonOrMileChange({ mile: e.target.value })}
            />
          </Field>
          <Field label="Amazon Paid">
            <Input
              type="number"
              step="0.01"
              value={form.amazonPaid}
              onChange={(e) => onAmazonOrMileChange({ amazonPaid: e.target.value })}
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
          <Field label="RPM">
            <Input
              type="number"
              step="0.01"
              value={form.rpm}
              onChange={(e) => setForm({ ...form, rpm: e.target.value })}
            />
          </Field>
          <Field label="Comment / week">
            <Input
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
              placeholder="Week45"
            />
          </Field>
          <Field label="Dispatch">
            <Input
              list="report-dispatch-list"
              value={form.dispatch}
              onChange={(e) => setForm({ ...form, dispatch: e.target.value })}
            />
            <datalist id="report-dispatch-list">
              {dispatchOptions.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label="Or pick dispatch">
            <Select
              value={dispatchOptions.includes(form.dispatch) ? form.dispatch : ''}
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
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteLoadReport(deleteId);
          setDeleteId(null);
        }}
        title="Delete report row?"
        message="This removes the row from the Reports sheet. Synced Relay loads are not deleted."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}
