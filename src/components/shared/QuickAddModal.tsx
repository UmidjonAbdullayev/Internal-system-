import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Input';
import { useData } from '@/context/DataContext';
import {
  buildReportFromLoad,
  findLoadsByLookup,
} from '@/lib/reportRows';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Load, LoadReport } from '@/types';
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
    loads,
    drivers,
    loadReports,
    addLoadReport,
    updateLoadReport,
  } = useData();

  const [mode, setMode] = useState<Mode>('auto');
  const [loadQuery, setLoadQuery] = useState('');
  const [dispatch, setDispatch] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [matched, setMatched] = useState<Load[]>([]);
  const [manual, setManual] = useState<ManualForm>(emptyManual);

  const dispatchOptions = useMemo(() => {
    const set = new Set<string>(['Khalid', 'David', 'Connor']);
    for (const r of loadReports) {
      if (r.dispatch.trim()) set.add(r.dispatch.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [loadReports]);

  const reset = () => {
    setMode('auto');
    setLoadQuery('');
    setDispatch('');
    setLookupError(null);
    setMatched([]);
    setManual(emptyManual());
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const runLookup = () => {
    setLookupError(null);
    const hits = findLoadsByLookup(loads, loadQuery);
    if (!hits.length) {
      setMatched([]);
      setLookupError(
        `No synced tour found for “${loadQuery.trim()}”. Switch to Manual or check the Load ID.`,
      );
      return;
    }
    // Prefer assigned / in-transit over bare spot bookings with same id
    const ranked = [...hits].sort((a, b) => {
      const score = (l: Load) => {
        let s = 0;
        if (l.driverId || (l.driverNameRaw && !/^spot/i.test(l.driverNameRaw))) s += 2;
        if (l.tripBucket === 'in_transit' || l.loadStatus === 'In Transit') s += 1;
        if (l.parentTripId) s += 1;
        return s;
      };
      return score(b) - score(a);
    });
    setMatched(ranked);
  };

  const saveFromLoad = (load: Load) => {
    if (!dispatch.trim()) {
      toast.error('Dispatch name is required');
      return;
    }
    const payload = buildReportFromLoad(load, drivers, dispatch.trim(), 'auto');
    const existing = loadReports.find((r) => r.loadUuid === load.id);
    if (existing) {
      updateLoadReport(existing.id, {
        ...payload,
        dispatch: dispatch.trim(),
        source: 'auto',
      });
    } else {
      addLoadReport(payload);
    }
    handleClose();
    navigate('/reports');
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

  const preview = matched[0]
    ? buildReportFromLoad(matched[0], drivers, dispatch.trim() || '—', 'auto')
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
              disabled={!matched[0] || !dispatch.trim()}
              onClick={() => matched[0] && saveFromLoad(matched[0])}
            >
              Add to Reports
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
            Enter a Load ID (or trip id). We fill the report row from synced Relay tours.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Load ID">
              <Input
                value={loadQuery}
                onChange={(e) => {
                  setLoadQuery(e.target.value);
                  setLookupError(null);
                  setMatched([]);
                }}
                placeholder="e.g. 112B7NG3F or T-112B7NG3F"
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

          {preview && (
            <div className="rounded-lg border border-border bg-bg p-3 text-xs space-y-1.5">
              <p className="text-sm font-semibold text-text">Preview</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                <span><span className="text-text-secondary">Trip</span> {preview.trip || '—'}</span>
                <span><span className="text-text-secondary">Load</span> {preview.loadIds || '—'}</span>
                <span><span className="text-text-secondary">Driver</span> {preview.driverName || '—'}</span>
                <span><span className="text-text-secondary">PU</span> {formatDate(preview.pickupDate, 'dd.MM.yyyy')}</span>
                <span><span className="text-text-secondary">Del</span> {formatDate(preview.deliveryDate, 'dd.MM.yyyy')}</span>
                <span><span className="text-text-secondary">Mile</span> {preview.mile || '—'}</span>
                <span><span className="text-text-secondary">Amazon</span> {formatCurrency(preview.amazonPaid)}</span>
                <span><span className="text-text-secondary">RPM</span> {formatCurrency(preview.rpm)}</span>
                <span><span className="text-text-secondary">Week</span> {preview.comment || '—'}</span>
                <span className="col-span-2"><span className="text-text-secondary">From</span> {preview.puLocation || '—'}</span>
                <span className="col-span-2"><span className="text-text-secondary">To</span> {preview.delLocation || '—'}</span>
              </div>
              {matched.length > 1 && (
                <p className="pt-1 text-text-secondary">
                  {matched.length} matches — using best ranked tour. Others:{' '}
                  {matched
                    .slice(1, 4)
                    .map((m) => m.loadId)
                    .join(', ')}
                </p>
              )}
            </div>
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
