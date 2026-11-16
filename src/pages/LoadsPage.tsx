import { useMemo, useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Plus, Download, Pencil, Trash2, Eye } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/SearchInput';
import { Select, Input, Field, Textarea } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { SortHeader, useSort, type SortDir } from '@/components/shared/SortHeader';
import { TripStatusIcon } from '@/components/shared/TripStatusIcon';
import { getLoadFinalGross } from '@/lib/calculations';
import { resolveTripStatus, tripStatusTooltip } from '@/lib/loadStatusDisplay';
import {
  formatCurrency,
  formatDate,
  downloadCSV,
  getDriverFullName,
  getWeekRange,
  todayISO,
} from '@/lib/utils';
import type { Load, LoadStatus, PaymentStatus, TrailerType, TripBucket } from '@/types';

const LOAD_STATUSES: LoadStatus[] = [
  'Available', 'Booked', 'Dispatched', 'In Transit', 'Delivered', 'Completed', 'Cancelled', 'Rejected',
];
const PAYMENT_STATUSES: PaymentStatus[] = [
  'Not Received', 'Pending', 'Processing', 'Paid', 'On Hold', 'Disputed',
];
const TRAILER_TYPES: TrailerType[] = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Box Truck'];

type LoadsTab = TripBucket | 'all';

const TRIP_TABS: { id: LoadsTab; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'in_transit', label: 'In Transit' },
  { id: 'history', label: 'History' },
  { id: 'all', label: 'All' },
];

function inferTripBucket(load: Load): TripBucket | null {
  // Terminal statuses always History — even if trip_bucket was left stale as active.
  if (
    load.loadStatus === 'Completed' ||
    load.loadStatus === 'Delivered' ||
    load.loadStatus === 'Cancelled' ||
    load.loadStatus === 'Rejected'
  ) {
    return 'history';
  }
  if (load.tripBucket === 'history') return 'history';
  if (load.tripBucket === 'in_transit' || load.tripBucket === 'upcoming') return load.tripBucket;
  if (load.loadStatus === 'In Transit' || load.loadStatus === 'Dispatched') return 'in_transit';
  if (load.loadStatus === 'Booked' || load.loadStatus === 'Available') return 'upcoming';
  return null;
}

function driverDisplayName(
  load: Load,
  driverMap: Record<string, { firstName: string; lastName: string }>,
): string {
  if (load.driverId && driverMap[load.driverId]) {
    return getDriverFullName(driverMap[load.driverId].firstName, driverMap[load.driverId].lastName);
  }
  return load.driverNameRaw || 'Unassigned';
}

/** Date range only applies on History — live boards show all matching rows. */
function tabUsesDateFilter(tab: LoadsTab): boolean {
  return tab === 'history';
}

const emptyForm = {
  loadId: '',
  amazonRefId: '',
  driverId: '' as string | null,
  loadStatus: 'Booked' as LoadStatus,
  paymentStatus: 'Not Received' as PaymentStatus,
  pickupLocation: '',
  deliveryLocation: '',
  pickupDate: new Date().toISOString().slice(0, 10),
  deliveryDate: new Date().toISOString().slice(0, 10),
  trailerId: '',
  trailerType: 'Dry Van' as TrailerType,
  tractorId: '',
  distanceMiles: 0,
  rateGross: 0,
  additionalCharges: 0,
  paymentDate: null as string | null,
  notes: '',
};

export function LoadsPage() {
  const { loads, drivers, addLoad, updateLoad, deleteLoad, dataSource, refreshData, companySettings } =
    useData();
  const [params, setParams] = useSearchParams();
  const today = todayISO(companySettings.timezone || 'America/Chicago');
  const week = getWeekRange(today);
  const urlTab = params.get('tab') as LoadsTab | null;
  const [tab, setTab] = useState<LoadsTab>(
    urlTab && TRIP_TABS.some((x) => x.id === urlTab) ? urlTab : 'in_transit',
  );
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [statusFilter, setStatusFilter] = useState(params.get('status') ?? '');
  const [paymentFilter, setPaymentFilter] = useState(params.get('paymentStatus') ?? '');
  const [driverFilter, setDriverFilter] = useState('');
  /** History-only date range (day / week / custom). Live tabs ignore these. */
  const [dateFrom, setDateFrom] = useState(params.get('from') || today);
  const [dateTo, setDateTo] = useState(params.get('to') || today);
  const datesActive = tabUsesDateFilter(tab);
  const [sortKey, setSortKey] = useState('deliveryDate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Load | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [detail, setDetail] = useState<Load | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (params.get('action') === 'new') {
      openCreate();
      params.delete('action');
      setParams(params, { replace: true });
    }
    const t = params.get('tab') as LoadsTab | null;
    if (t && TRIP_TABS.some((x) => x.id === t)) setTab(t);
  }, [params, setParams]);

  const driverMap = useMemo(
    () => Object.fromEntries(drivers.map((d) => [d.id, d])),
    [drivers]
  );

  const tabCounts = useMemo(() => {
    const counts: Record<LoadsTab, number> = {
      upcoming: 0,
      in_transit: 0,
      history: 0,
      all: loads.length,
    };
    for (const l of loads) {
      const b = inferTripBucket(l);
      if (b) counts[b] += 1;
    }
    return counts;
  }, [loads]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return loads.filter((l) => {
      const bucket = inferTripBucket(l);
      if (tab !== 'all' && bucket !== tab) return false;
      if (statusFilter && l.loadStatus !== statusFilter) return false;
      if (paymentFilter && l.paymentStatus !== paymentFilter) return false;
      if (driverFilter && l.driverId !== driverFilter) return false;
      // Upcoming / In Transit / All: no date filter — live boards show every matching row.
      if (datesActive && (dateFrom || dateTo)) {
        const inRange = (d: string) => {
          if (!d) return false;
          if (dateFrom && d < dateFrom) return false;
          if (dateTo && d > dateTo) return false;
          return true;
        };
        // Match ops day on pickup or delivery (Relay dates).
        if (!inRange(l.deliveryDate) && !inRange(l.pickupDate)) return false;
      }
      if (q) {
        const hay = [
          l.loadId,
          l.amazonRefId,
          l.parentTripId,
          l.trailerId,
          l.tractorId,
          l.pickupLocation,
          l.deliveryLocation,
          driverDisplayName(l, driverMap),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [loads, tab, search, statusFilter, paymentFilter, driverFilter, dateFrom, dateTo, datesActive, driverMap]);

  const sorted = useSort(filtered, sortKey, sortDir, {
    loadId: (l) => l.loadId,
    deliveryDate: (l) => l.deliveryDate,
    pickupDate: (l) => l.pickupDate,
    rateGross: (l) => getLoadFinalGross(l),
    distanceMiles: (l) => l.distanceMiles,
    loadStatus: (l) => l.loadStatus,
    paymentStatus: (l) => l.paymentStatus,
    driver: (l) => driverDisplayName(l, driverMap),
    tractor: (l) => l.tractorId || '',
    trailer: (l) => l.trailerId || '',
  });

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...emptyForm,
      loadId: `LD-${8500 + loads.length}`,
      amazonRefId: `AMZ-R${String(920200 + loads.length).padStart(7, '0')}`,
    });
    setFormOpen(true);
  };

  const openEdit = (load: Load) => {
    setEditing(load);
    setForm({
      loadId: load.loadId,
      amazonRefId: load.amazonRefId,
      driverId: load.driverId,
      loadStatus: load.loadStatus,
      paymentStatus: load.paymentStatus,
      pickupLocation: load.pickupLocation,
      deliveryLocation: load.deliveryLocation,
      pickupDate: load.pickupDate,
      deliveryDate: load.deliveryDate,
      trailerId: load.trailerId,
      trailerType: load.trailerType,
      tractorId: load.tractorId || '',
      distanceMiles: load.distanceMiles,
      rateGross: load.rateGross,
      additionalCharges: load.additionalCharges,
      paymentDate: load.paymentDate,
      notes: load.notes,
    });
    setFormOpen(true);
  };

  const saveForm = () => {
    if (!form.loadId || !form.pickupLocation || !form.deliveryLocation) return;
    const payload = {
      ...form,
      driverId: form.driverId || null,
      paymentDate: form.paymentDate || null,
      tractorId: form.tractorId || '',
    };
    if (editing) updateLoad(editing.id, payload);
    else addLoad(payload);
    setFormOpen(false);
  };

  const exportCSV = () => {
    downloadCSV(
      'loads-export.csv',
      [
        'Trip/Load ID', 'Parent Trip', 'Driver', 'Status', 'Status Bar', 'Tractor', 'Trailer',
        'Pickup', 'Delivery', 'Pickup Date', 'Delivery Date', 'Miles', 'Pay', 'Bucket',
      ],
      sorted.map((l) => [
        l.loadId,
        l.parentTripId || '',
        driverDisplayName(l, driverMap),
        resolveTripStatus(l).name,
        tripStatusTooltip(resolveTripStatus(l)),
        l.tractorId || '',
        l.trailerId || '',
        l.pickupLocation,
        l.deliveryLocation,
        l.pickupDate,
        l.deliveryDate,
        l.distanceMiles,
        getLoadFinalGross(l),
        inferTripBucket(l) || '',
      ])
    );
  };

  const selectTab = (id: LoadsTab) => {
    setTab(id);
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Loads / Trips"
        subtitle={`${sorted.length} shown · live ${dataSource} · mirrors Relay Upcoming / In Transit / History`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void refreshData()}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add Load
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {TRIP_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text'
            }`}
          >
            {t.label}
            <span className="ml-2 text-xs tabular-nums text-text-secondary">{tabCounts[t.id]}</span>
          </button>
        ))}
      </div>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search trip, load, driver, tractor, trailer..."
            className="w-full sm:w-72"
          />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36">
            <option value="">All Statuses</option>
            {LOAD_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="w-40">
            <option value="">All Payments</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Select value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} className="w-44">
            <option value="">All Drivers</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {getDriverFullName(d.firstName, d.lastName)}
              </option>
            ))}
          </Select>
          {datesActive ? (
            <>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                  From
                </label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-36"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                  To
                </label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-36"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => {
                  setDateFrom(today);
                  setDateTo(today);
                }}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => {
                  setDateFrom(week.start);
                  setDateTo(week.end);
                }}
              >
                This week
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
              >
                All dates
              </Button>
            </>
          ) : (
            <p className="pb-1 text-xs text-text-secondary">
              {tab === 'upcoming'
                ? 'Upcoming board — all booked trips, no date filter.'
                : tab === 'in_transit'
                  ? 'In Transit board — all live trips, no date filter.'
                  : 'All trips — date range is on History only.'}
            </p>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1400px]">
            <thead>
              <tr className="border-b border-border bg-bg/80">
                <SortHeader label="Trip / Load" sortKey="loadId" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Driver" sortKey="driver" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Tractor" sortKey="tractor" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Trailer" sortKey="trailer" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Route</th>
                <SortHeader label="Status" sortKey="loadStatus" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Pay" sortKey="rateGross" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Delivery" sortKey="deliveryDate" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => {
                const d = l.driverId ? driverMap[l.driverId] : null;
                return (
                  <tr
                    key={l.id}
                    className="border-b border-border/60 table-row-hover cursor-pointer"
                    onClick={() => setDetail(l)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-primary">{l.loadId}</div>
                      {l.parentTripId && l.parentTripId !== l.loadId && (
                        <div className="text-[11px] text-text-secondary">Trip {l.parentTripId}</div>
                      )}
                      {l.jobType && (
                        <div className="text-[10px] text-text-secondary">{l.jobType}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {d ? (
                        <Link
                          to={`/drivers/${d.id}`}
                          className="font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {getDriverFullName(d.firstName, d.lastName)}
                        </Link>
                      ) : (
                        <span className={l.driverNameRaw ? '' : 'text-text-secondary italic'}>
                          {l.driverNameRaw || 'Unassigned'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums">{l.tractorId || '—'}</td>
                    <td className="px-3 py-2.5 text-xs">
                      <div>{l.trailerId || '—'}</div>
                      <div className="text-text-secondary">{l.trailerType}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <div>{l.pickupLocation}</div>
                      <div className="text-text-secondary">→ {l.deliveryLocation}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <TripStatusIcon load={l} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                      {formatCurrency(getLoadFinalGross(l))}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap">{formatDate(l.deliveryDate, 'MMM d')}</td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setDetail(l)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(l)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteId(l.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sorted.length === 0 && (
            <EmptyState
              title={
                loads.length === 0
                  ? 'No trips synced yet'
                  : tab === 'in_transit'
                    ? 'No In Transit trips'
                    : tab === 'upcoming'
                      ? 'No Upcoming trips'
                      : tab === 'history'
                        ? 'No History trips in this date range'
                        : 'No trips in this tab'
              }
              description={
                loads.length === 0
                  ? 'Open Amazon Relay Trips with the extension live (GO LIVE), then refresh.'
                  : tab === 'history' && (dateFrom || dateTo)
                    ? 'Widen the History date range (This week / All dates), or sync Relay History.'
                    : tab === 'in_transit' && tabCounts.history > 0
                      ? `${tabCounts.history} trip(s) are under History. Switch tabs, or Force scan with Upcoming/In Transit open.`
                      : 'Open Amazon Relay Trips with the extension live, or add a load manually.'
              }
              actionLabel={tab === 'history' && (dateFrom || dateTo) ? 'All dates' : 'Add Load'}
              onAction={
                tab === 'history' && (dateFrom || dateTo)
                  ? () => {
                      setDateFrom('');
                      setDateTo('');
                    }
                  : openCreate
              }
            />
          )}
        </div>
      </Card>

      {/* Create / Edit Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit Load ${editing.loadId}` : 'Add New Load'}
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={saveForm}>{editing ? 'Save Changes' : 'Create Load'}</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Load ID"><Input value={form.loadId} onChange={(e) => setForm({ ...form, loadId: e.target.value })} /></Field>
          <Field label="Amazon Reference ID"><Input value={form.amazonRefId} onChange={(e) => setForm({ ...form, amazonRefId: e.target.value })} /></Field>
          <Field label="Driver">
            <Select
              value={form.driverId ?? ''}
              onChange={(e) => setForm({ ...form, driverId: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>{getDriverFullName(d.firstName, d.lastName)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Load Status">
            <Select value={form.loadStatus} onChange={(e) => setForm({ ...form, loadStatus: e.target.value as LoadStatus })}>
              {LOAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Payment Status">
            <Select value={form.paymentStatus} onChange={(e) => setForm({ ...form, paymentStatus: e.target.value as PaymentStatus })}>
              {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Payment Date">
            <Input type="date" value={form.paymentDate ?? ''} onChange={(e) => setForm({ ...form, paymentDate: e.target.value || null })} />
          </Field>
          <Field label="Pickup Location"><Input value={form.pickupLocation} onChange={(e) => setForm({ ...form, pickupLocation: e.target.value })} /></Field>
          <Field label="Delivery Location"><Input value={form.deliveryLocation} onChange={(e) => setForm({ ...form, deliveryLocation: e.target.value })} /></Field>
          <Field label="Trailer ID"><Input value={form.trailerId} onChange={(e) => setForm({ ...form, trailerId: e.target.value })} /></Field>
          <Field label="Tractor ID"><Input value={form.tractorId} onChange={(e) => setForm({ ...form, tractorId: e.target.value })} /></Field>
          <Field label="Pickup Date"><Input type="date" value={form.pickupDate} onChange={(e) => setForm({ ...form, pickupDate: e.target.value })} /></Field>
          <Field label="Delivery Date"><Input type="date" value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} /></Field>
          <Field label="Trailer Type">
            <Select value={form.trailerType} onChange={(e) => setForm({ ...form, trailerType: e.target.value as TrailerType })}>
              {TRAILER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Distance (Miles)"><Input type="number" value={form.distanceMiles} onChange={(e) => setForm({ ...form, distanceMiles: Number(e.target.value) })} /></Field>
          <Field label="Rate / Gross ($)"><Input type="number" step="0.01" value={form.rateGross} onChange={(e) => setForm({ ...form, rateGross: Number(e.target.value) })} /></Field>
          <Field label="Additional Charges ($)"><Input type="number" step="0.01" value={form.additionalCharges} onChange={(e) => setForm({ ...form, additionalCharges: Number(e.target.value) })} /></Field>
          <Field label="Notes" className="sm:col-span-2 lg:col-span-3">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <p className="mt-3 text-sm text-text-secondary">
          Final Gross: <span className="font-semibold text-text">{formatCurrency(form.rateGross + form.additionalCharges)}</span>
        </p>
      </Modal>

      {/* Detail Drawer */}
      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `Load ${detail.loadId}` : ''}
        width="max-w-2xl"
        footer={
          detail && (
            <>
              <Button variant="outline" onClick={() => { openEdit(detail); setDetail(null); }}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              <Button variant="danger" onClick={() => { setDeleteId(detail.id); setDetail(null); }}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </>
          )
        }
      >
        {detail && (
          <div className="space-y-5 animate-fade-in">
            <div className="flex flex-wrap gap-2">
              <TripStatusIcon load={detail} />
              <Badge status={detail.paymentStatus} />
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Info label="Amazon Ref" value={detail.amazonRefId} />
              <Info
                label="Driver"
                value={
                  detail.driverId && driverMap[detail.driverId]
                    ? getDriverFullName(driverMap[detail.driverId].firstName, driverMap[detail.driverId].lastName)
                    : 'Unassigned'
                }
              />
              <Info label="Pickup" value={detail.pickupLocation} />
              <Info label="Delivery" value={detail.deliveryLocation} />
              <Info label="Pickup Date" value={formatDate(detail.pickupDate)} />
              <Info label="Delivery Date" value={formatDate(detail.deliveryDate)} />
              <Info label="Trailer" value={`${detail.trailerId || '—'} (${detail.trailerType})`} />
              <Info label="Tractor" value={detail.tractorId || '—'} />
              <Info label="Parent Trip" value={detail.parentTripId || '—'} />
              <Info label="Trip tab" value={inferTripBucket(detail) || '—'} />
              <Info label="Status" value={tripStatusTooltip(resolveTripStatus(detail))} />
              <Info label="Distance" value={`${detail.distanceMiles} mi`} />
              <Info label="Rate Gross" value={formatCurrency(detail.rateGross)} />
              <Info label="Additional Charges" value={formatCurrency(detail.additionalCharges)} />
              <Info label="Final Gross" value={formatCurrency(getLoadFinalGross(detail))} />
              <Info label="Payment Date" value={detail.paymentDate ? formatDate(detail.paymentDate) : '—'} />
            </div>
            {detail.notes && (
              <div>
                <p className="text-xs font-medium text-text-secondary mb-1">Notes</p>
                <p className="text-sm rounded-lg bg-bg p-3">{detail.notes}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-text-secondary mb-2">Status History</p>
              <div className="space-y-2">
                {detail.statusHistory.map((h, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                    <Badge status={h.status} />
                    <span className="text-xs text-text-secondary">
                      {formatDate(h.timestamp, 'MMM d, yyyy h:mm a')}
                    </span>
                    {h.note && <span className="text-xs text-text-secondary">— {h.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteLoad(deleteId)}
        title="Delete Load"
        message="Are you sure you want to delete this load? This action cannot be undone."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="font-medium text-text">{value}</p>
    </div>
  );
}
