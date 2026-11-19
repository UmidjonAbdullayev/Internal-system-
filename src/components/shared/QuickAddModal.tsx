import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Input';
import { useData } from '@/context/DataContext';
import { computeRpm, formatSheetDate } from '@/lib/reportRows';
import {
  findReportLoads,
  moneyBucketLabel,
  type ReportLoadRow,
} from '@/lib/reportLoadMoney';
import {
  compareStops,
  facilityLabel,
  isLegCancelled,
  legDriverName,
  orderedLegs,
  tripDriverNames,
} from '@/lib/relayTrips';
import { cn, formatCurrency } from '@/lib/utils';
import type { LoadReport, RelayTrip } from '@/types';
import { toast } from 'sonner';

type Mode = 'auto' | 'manual';

type ManualForm = {
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
  comment: string;
  dispatch: string;
};

const emptyManual = (): ManualForm => ({
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
  comment: '',
  dispatch: '',
});

export function QuickAddModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const {
    loadReports,
    addLoadReport,
    reportLoads,
    relayTrips,
    ensureTripStops,
    upsertLoadOverride,
  } = useData();

  const [mode, setMode] = useState<Mode>('auto');
  const [loadQuery, setLoadQuery] = useState('');
  const [dispatch, setDispatch] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [matched, setMatched] = useState<ReportLoadRow[]>([]);
  const [pickedTour, setPickedTour] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [manual, setManual] = useState<ManualForm>(emptyManual);

  const dispatchOptions = useMemo(() => {
    const set = new Set<string>(['Khalid', 'David', 'Connor']);
    for (const r of loadReports) {
      if (r.dispatch.trim()) set.add(r.dispatch.trim());
    }
    for (const r of reportLoads) {
      if (r.dispatch.trim()) set.add(r.dispatch.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [loadReports, reportLoads]);

  const reset = () => {
    setMode('auto');
    setLoadQuery('');
    setDispatch('');
    setLookupError(null);
    setMatched([]);
    setPickedTour(null);
    setComment('');
    setManual(emptyManual());
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const selectTour = (row: ReportLoadRow | undefined) => {
    setPickedTour(row?.tourId ?? null);
    // Prefill with what's already saved for this tour.
    setDispatch(row?.dispatch || '');
    setComment(row?.comment || '');
    const trip = row ? relayTrips.find((t) => tourKey(t.tripId) === row.tourId) : null;
    if (trip) void ensureTripStops([trip.tripId]);
  };

  const runLookup = () => {
    setLookupError(null);
    const hits = findReportLoads(reportLoads, loadQuery);
    setMatched(hits);
    if (!hits.length) {
      selectTour(undefined);
      setLookupError(
        `No synced tour found for “${loadQuery.trim()}”. Check the ID, or use Manual for a non-Relay load.`,
      );
      return;
    }
    selectTour(hits[0]);
  };

  const saveTour = async (row: ReportLoadRow) => {
    if (!dispatch.trim()) {
      toast.error('Dispatch name is required');
      return;
    }
    setSaving(true);
    try {
      // Relay tours are already in Reports automatically; this only stores the manual fields.
      await upsertLoadOverride(row.tourId, {
        dispatch: dispatch.trim(),
        comment: comment.trim() || null,
      });
      handleClose();
      navigate('/reports');
    } finally {
      setSaving(false);
    }
  };

  const saveManual = () => {
    if (!manual.loadIds.trim() && !manual.trip.trim()) {
      toast.error('Load or Trip is required');
      return;
    }
    if (!manual.dispatch.trim()) {
      toast.error('Dispatch name is required');
      return;
    }
    const amazonPaid = Number(manual.amazonPaid) || 0;
    const driverPaid =
      manual.driverPaid !== '' ? Number(manual.driverPaid) || 0 : amazonPaid;
    const mile = manual.mile.trim();
    const rpm =
      mile && mile.toUpperCase() !== 'TONU' && Number(mile.replace(',', '.')) > 0
        ? amazonPaid / Number(mile.replace(',', '.'))
        : 0;
    const row: Omit<LoadReport, 'id' | 'createdAt' | 'updatedAt'> = {
      loadUuid: null,
      broker: manual.broker.trim() || 'Amazon',
      trip: manual.trip.trim(),
      loadIds: manual.loadIds.trim(),
      driverName: manual.driverName.trim(),
      pickupDate: manual.pickupDate || null,
      deliveryDate: manual.deliveryDate || null,
      puLocation: manual.puLocation.trim(),
      delLocation: manual.delLocation.trim(),
      mile,
      amazonPaid,
      driverPaid,
      rpm: Math.round(rpm * 100) / 100,
      comment: manual.comment.trim(),
      dispatch: manual.dispatch.trim(),
      source: 'manual',
    };
    addLoadReport(row);
    handleClose();
    navigate('/reports');
  };

  const preview = matched.find((m) => m.tourId === pickedTour) || null;
  const previewTrip = preview
    ? relayTrips.find((t) => tourKey(t.tripId) === preview.tourId) || null
    : null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Quick Add"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {mode === 'auto' ? (
            <Button
              disabled={!preview || !dispatch.trim() || saving}
              onClick={() => preview && void saveTour(preview)}
            >
              Save to Reports
            </Button>
          ) : (
            <Button onClick={saveManual}>Add to Reports</Button>
          )}
        </>
      }
    >
      <div className="mb-4 flex rounded-lg border border-border bg-bg p-1">
        <button
          type="button"
          onClick={() => {
            setMode('auto');
            setLookupError(null);
          }}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            mode === 'auto'
              ? 'bg-white text-primary shadow-sm'
              : 'text-text-secondary hover:text-text'
          }`}
        >
          Auto fill
        </button>
        <button
          type="button"
          onClick={() => setMode('manual')}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            mode === 'manual'
              ? 'bg-white text-primary shadow-sm'
              : 'text-text-secondary hover:text-text'
          }`}
        >
          Manual
        </button>
      </div>

      {mode === 'auto' ? (
        <div className="space-y-4">
          <p className="text-xs text-text-secondary">
            Enter a trip ID (T-…) or any load ID. Relay tours are already in Reports automatically;
            here you check the tour and set its Dispatch / Comment.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Trip or Load ID">
              <Input
                value={loadQuery}
                onChange={(e) => {
                  setLoadQuery(e.target.value);
                  setLookupError(null);
                  setMatched([]);
                  setPickedTour(null);
                }}
                placeholder="e.g. T-1133L9DZ1 or 115M168Z4"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    runLookup();
                  }
                }}
              />
            </Field>
            <Field label="Dispatch">
              <Input
                list="qa-dispatch-list"
                value={dispatch}
                onChange={(e) => setDispatch(e.target.value)}
                placeholder="Khalid, David, Connor…"
              />
              <datalist id="qa-dispatch-list">
                {dispatchOptions.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={runLookup}>
              Look up tour
            </Button>
            {lookupError && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setMode('manual');
                  setManual((m) => ({
                    ...m,
                    loadIds: loadQuery.trim(),
                    dispatch: dispatch.trim(),
                  }));
                }}
              >
                Fall back to Manual
              </Button>
            )}
          </div>

          {lookupError && (
            <div className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
              {lookupError}
            </div>
          )}

          {matched.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-text-secondary">{matched.length} tours match:</span>
              {matched.slice(0, 8).map((m) => (
                <button
                  key={m.tourId}
                  type="button"
                  onClick={() => selectTour(m)}
                  className={cn(
                    'rounded-md border px-2 py-0.5 font-mono',
                    m.tourId === pickedTour
                      ? 'border-primary bg-info-bg text-primary'
                      : 'border-border bg-white text-text-secondary hover:text-text',
                  )}
                >
                  {m.tripDisplay}
                </button>
              ))}
            </div>
          )}

          {preview && <TourPreview row={preview} trip={previewTrip} />}

          {preview && (
            <Field label="Comment (optional)">
              <Input value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Broker">
            <Input
              value={manual.broker}
              onChange={(e) => setManual({ ...manual, broker: e.target.value })}
            />
          </Field>
          <Field label="Dispatch">
            <Input
              list="qa-manual-dispatch"
              value={manual.dispatch}
              onChange={(e) => setManual({ ...manual, dispatch: e.target.value })}
            />
            <datalist id="qa-manual-dispatch">
              {dispatchOptions.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label="Trip">
            <Input
              value={manual.trip}
              onChange={(e) => setManual({ ...manual, trip: e.target.value })}
            />
          </Field>
          <Field label="Load">
            <Input
              value={manual.loadIds}
              onChange={(e) => setManual({ ...manual, loadIds: e.target.value })}
            />
          </Field>
          <Field label="Driver name">
            <Input
              value={manual.driverName}
              onChange={(e) => setManual({ ...manual, driverName: e.target.value })}
            />
          </Field>
          <Field label="Comment / week">
            <Input
              value={manual.comment}
              onChange={(e) => setManual({ ...manual, comment: e.target.value })}
              placeholder="Week45"
            />
          </Field>
          <Field label="Pick up">
            <Input
              type="date"
              value={manual.pickupDate}
              onChange={(e) => setManual({ ...manual, pickupDate: e.target.value })}
            />
          </Field>
          <Field label="Delivery">
            <Input
              type="date"
              value={manual.deliveryDate}
              onChange={(e) => setManual({ ...manual, deliveryDate: e.target.value })}
            />
          </Field>
          <Field label="PU location">
            <Input
              value={manual.puLocation}
              onChange={(e) => setManual({ ...manual, puLocation: e.target.value })}
            />
          </Field>
          <Field label="Del location">
            <Input
              value={manual.delLocation}
              onChange={(e) => setManual({ ...manual, delLocation: e.target.value })}
            />
          </Field>
          <Field label="Mile">
            <Input
              value={manual.mile}
              onChange={(e) => setManual({ ...manual, mile: e.target.value })}
            />
          </Field>
          <Field label="Amazon Paid">
            <Input
              type="number"
              step="0.01"
              value={manual.amazonPaid}
              onChange={(e) => setManual({ ...manual, amazonPaid: e.target.value })}
            />
          </Field>
          <Field label="Driver Paid">
            <Input
              type="number"
              step="0.01"
              value={manual.driverPaid}
              onChange={(e) => setManual({ ...manual, driverPaid: e.target.value })}
            />
          </Field>
          <Field label="Dispatch (pick)">
            <Select
              value={dispatchOptions.includes(manual.dispatch) ? manual.dispatch : ''}
              onChange={(e) => setManual({ ...manual, dispatch: e.target.value })}
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
  );
}

function tourKey(id: string): string {
  return id.trim().toUpperCase().replace(/^T-/, '');
}

function PreviewItem({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-0.5 break-words text-sm text-text">{children}</p>
    </div>
  );
}

/** Whole-tour preview: same numbers as the Reports row, plus every leg. */
function TourPreview({ row, trip }: { row: ReportLoadRow; trip: RelayTrip | null }) {
  const drivers = trip ? tripDriverNames(trip) : [];
  const legs = trip ? orderedLegs(trip) : [];
  const bucket = moneyBucketLabel(row);
  const rpm = row.rpm || computeRpm(row.amazonPaid, row.mile);
  return (
    <div className="space-y-3 rounded-lg border border-border bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-base font-bold text-primary">{row.tripDisplay}</span>
        <span
          className={cn(
            'rounded-md border px-2 py-0.5 text-[11px] font-semibold',
            row.moneyBucket === 'income'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : row.moneyBucket === 'pending_invoice'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-blue-200 bg-blue-50 text-blue-700',
          )}
        >
          {bucket}
        </span>
        {row.isTonu && (
          <span className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
            TONU
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <PreviewItem label="Amazon pay">{formatCurrency(row.amazonPaid)}</PreviewItem>
        <PreviewItem label="Miles">{row.mile || '—'}</PreviewItem>
        <PreviewItem label="RPM">{rpm ? `$${Number(rpm).toFixed(2)}` : '—'}</PreviewItem>
        <PreviewItem label="Driver paid">{formatCurrency(row.driverPaid)}</PreviewItem>
        <PreviewItem label="Pick up" wide>
          {row.puLocation || '—'} · {formatSheetDate(row.pickupDate) || '—'}
        </PreviewItem>
        <PreviewItem label="Delivery" wide>
          {row.delLocation || '—'} · {formatSheetDate(row.deliveryDate) || '—'}
        </PreviewItem>
        <PreviewItem label={drivers.length > 1 ? `Drivers (${drivers.length})` : 'Driver'} wide>
          {(drivers.length ? drivers : [row.driverName || '—']).join(' → ')}
        </PreviewItem>
        <PreviewItem label="Week">
          {row.weekLabel} {row.estimatedWeek ? '(estimated)' : '(from invoice)'}
        </PreviewItem>
        <PreviewItem label="Paid">{row.paidStatus || '—'}</PreviewItem>
        <PreviewItem label="Loads" wide>
          <span className="font-mono text-xs">{row.loadIds || '—'}</span>
        </PreviewItem>
        <PreviewItem label="Saved dispatch">{row.dispatch || '—'}</PreviewItem>
        <PreviewItem label="Saved comment">{row.comment || '—'}</PreviewItem>
      </div>

      {legs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                <th className="py-1 pr-2">Load</th>
                <th className="py-1 pr-2">From → To</th>
                <th className="py-1 pr-2">Driver</th>
                <th className="py-1 pr-2">Tractor / Trailer</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 text-right">Leg pay</th>
              </tr>
            </thead>
            <tbody>
              {legs.map((leg) => {
                const stops = [...leg.stops].sort(compareStops);
                const cancelled = isLegCancelled(leg);
                return (
                  <tr
                    key={leg.loadId}
                    className={cn('border-b border-border/60', cancelled && 'text-slate-400 line-through')}
                  >
                    <td className="py-1 pr-2 font-mono">{leg.loadId}</td>
                    <td className="py-1 pr-2">
                      {stops.length
                        ? `${facilityLabel(stops[0])} → ${facilityLabel(stops[stops.length - 1])}`
                        : leg.facilitySequence || '—'}
                    </td>
                    <td className="py-1 pr-2">{trip ? legDriverName(trip, leg) || '—' : '—'}</td>
                    <td className="py-1 pr-2 font-mono">
                      {leg.tractorId || '—'} / {leg.trailerId || '—'}
                    </td>
                    <td className="py-1 pr-2">{cancelled ? 'Cancelled' : leg.executionStatus || '—'}</td>
                    <td className="py-1 text-right tabular-nums">
                      {leg.payout != null ? formatCurrency(leg.payout) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-text-secondary">
            Amazon pay above is the whole tour (what Amazon pays); leg pay is shown for reference.
          </p>
        </div>
      )}
    </div>
  );
}
