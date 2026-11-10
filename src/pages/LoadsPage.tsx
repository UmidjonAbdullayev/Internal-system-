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
import { getLoadFinalGross } from '@/lib/calculations';
import {
  formatCurrency,
  formatDate,
  downloadCSV,
  getDriverFullName,
} from '@/lib/utils';
import type { Load, LoadStatus, PaymentStatus, TrailerType } from '@/types';

const LOAD_STATUSES: LoadStatus[] = [
  'Available', 'Booked', 'Dispatched', 'In Transit', 'Delivered', 'Completed', 'Cancelled', 'Rejected',
];
const PAYMENT_STATUSES: PaymentStatus[] = [
  'Not Received', 'Pending', 'Processing', 'Paid', 'On Hold', 'Disputed',
];
const TRAILER_TYPES: TrailerType[] = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Box Truck'];

const emptyForm = {
  loadId: '',
  amazonRefId: '',
  driverId: '' as string | null,
  loadStatus: 'Booked' as LoadStatus,
  paymentStatus: 'Not Received' as PaymentStatus,
  pickupLocation: '',
  deliveryLocation: '',
  pickupDate: '2026-11-10',
  deliveryDate: '2026-11-11',
  trailerId: '',
  trailerType: 'Dry Van' as TrailerType,
  distanceMiles: 0,
  rateGross: 0,
  additionalCharges: 0,
  paymentDate: null as string | null,
  notes: '',
};

export function LoadsPage() {
  const { loads, drivers, addLoad, updateLoad, deleteLoad } = useData();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [statusFilter, setStatusFilter] = useState(params.get('status') ?? '');
  const [paymentFilter, setPaymentFilter] = useState(params.get('paymentStatus') ?? '');
  const [driverFilter, setDriverFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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
  }, [params, setParams]);

  const driverMap = useMemo(
    () => Object.fromEntries(drivers.map((d) => [d.id, d])),
    [drivers]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return loads.filter((l) => {
      if (statusFilter && l.loadStatus !== statusFilter) return false;
      if (paymentFilter && l.paymentStatus !== paymentFilter) return false;
      if (driverFilter && l.driverId !== driverFilter) return false;
      if (dateFrom && l.deliveryDate < dateFrom) return false;
      if (dateTo && l.deliveryDate > dateTo) return false;
      if (q) {
        const driver = l.driverId ? driverMap[l.driverId] : null;
        const hay = [
          l.loadId,
          l.amazonRefId,
          l.trailerId,
          l.pickupLocation,
          l.deliveryLocation,
          driver ? getDriverFullName(driver.firstName, driver.lastName) : '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [loads, search, statusFilter, paymentFilter, driverFilter, dateFrom, dateTo, driverMap]);

  const sorted = useSort(filtered, sortKey, sortDir, {
    loadId: (l) => l.loadId,
    deliveryDate: (l) => l.deliveryDate,
    pickupDate: (l) => l.pickupDate,
    rateGross: (l) => getLoadFinalGross(l),
    distanceMiles: (l) => l.distanceMiles,
    loadStatus: (l) => l.loadStatus,
    paymentStatus: (l) => l.paymentStatus,
    driver: (l) => {
      const d = l.driverId ? driverMap[l.driverId] : null;
      return d ? getDriverFullName(d.firstName, d.lastName) : '';
    },
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
    if (editing) {
      updateLoad(editing.id, {
        ...form,
        driverId: form.driverId || null,
        paymentDate: form.paymentDate || null,
      });
    } else {
      addLoad({
        ...form,
        driverId: form.driverId || null,
        paymentDate: form.paymentDate || null,
      });
    }
    setFormOpen(false);
  };

  const exportCSV = () => {
    downloadCSV(
      'loads-export.csv',
      [
        'Load ID', 'Amazon Ref', 'Driver', 'Load Status', 'Payment Status',
        'Pickup', 'Delivery', 'Pickup Date', 'Delivery Date', 'Trailer', 'Miles',
        'Gross', 'Additional', 'Final Gross', 'Notes',
      ],
      sorted.map((l) => {
        const d = l.driverId ? driverMap[l.driverId] : null;
        return [
          l.loadId,
          l.amazonRefId,
          d ? getDriverFullName(d.firstName, d.lastName) : '',
          l.loadStatus,
          l.paymentStatus,
          l.pickupLocation,
          l.deliveryLocation,
          l.pickupDate,
          l.deliveryDate,
          l.trailerId,
          l.distanceMiles,
          l.rateGross,
          l.additionalCharges,
          getLoadFinalGross(l),
          l.notes,
        ];
      })
    );
  };

  return (
    <div>
      <PageHeader
        title="Loads CRM"
        subtitle={`${sorted.length} loads · Amazon Relay & manual entries`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add Load
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search load ID, driver, trailer, location..."
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
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1400px]">
            <thead>
              <tr className="border-b border-border bg-bg/80">
                <SortHeader label="Load ID" sortKey="loadId" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Amazon Ref</th>
                <SortHeader label="Driver" sortKey="driver" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Status" sortKey="loadStatus" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Route</th>
                <SortHeader label="Pickup" sortKey="pickupDate" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Delivery" sortKey="deliveryDate" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Trailer</th>
                <SortHeader label="Miles" sortKey="distanceMiles" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Final Gross" sortKey="rateGross" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Payment" sortKey="paymentStatus" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
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
                    <td className="px-3 py-2.5 font-medium text-primary">{l.loadId}</td>
                    <td className="px-3 py-2.5 text-xs text-text-secondary">{l.amazonRefId}</td>
                    <td className="px-3 py-2.5">
                      {d ? (
                        <div>
                          <Link
                            to={`/drivers/${d.id}`}
                            className="font-medium hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {getDriverFullName(d.firstName, d.lastName)}
                          </Link>
                          <div className="mt-0.5"><Badge status={d.status} /></div>
                        </div>
                      ) : (
                        <span className="text-text-secondary italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5"><Badge status={l.loadStatus} /></td>
                    <td className="px-3 py-2.5 text-xs">
                      <div>{l.pickupLocation}</div>
                      <div className="text-text-secondary">→ {l.deliveryLocation}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap">{formatDate(l.pickupDate, 'MMM d')}</td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap">{formatDate(l.deliveryDate, 'MMM d')}</td>
                    <td className="px-3 py-2.5 text-xs">
                      <div>{l.trailerId || '—'}</div>
                      <div className="text-text-secondary">{l.trailerType}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{l.distanceMiles}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                      {formatCurrency(getLoadFinalGross(l))}
                      {l.additionalCharges > 0 && (
                        <div className="text-[10px] font-normal text-text-secondary">
                          +{formatCurrency(l.additionalCharges)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5"><Badge status={l.paymentStatus} /></td>
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
            <EmptyState title="No loads found" description="Try adjusting filters or add a new load." actionLabel="Add Load" onAction={openCreate} />
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
              <Badge status={detail.loadStatus} />
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
