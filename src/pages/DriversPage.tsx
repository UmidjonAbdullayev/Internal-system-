import { useMemo, useState, useEffect, useRef } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, Pencil, UserX, Eye, Download, Upload } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/SearchInput';
import { Select, Input, Field, Textarea } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { SortHeader, useSort, type SortDir } from '@/components/shared/SortHeader';
import {
  deriveDriverStatus,
  getActiveLoadsForDriver,
} from '@/lib/calculations';
import {
  formatCurrency,
  formatDate,
  downloadCSV,
  getDriverFullName,
} from '@/lib/utils';
import {
  amazonWeekRangeFromAnchor,
  laTodayISO,
} from '@/lib/amazonWeek';
import {
  getDriverAmazonGross,
  reportLoadsForDriver,
} from '@/lib/reportLoadMoney';
import { csvToObjects, mapDriverCsvRow } from '@/lib/csvImport';
import { toast } from 'sonner';
import type { Driver, DriverStatus } from '@/types';

const STATUSES: DriverStatus[] = ['Active', 'Inactive', 'On Load', 'Available', 'On Break', 'Suspended'];

const emptyForm = {
  driverId: '',
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  status: 'Available' as DriverStatus,
  assignedTruck: '',
  trailerId: '',
  hireDate: '2026-11-10',
  notes: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  licenseNumber: '',
  licenseExpiry: '2028-01-01',
};

export function DriversPage() {
  const { drivers, loads, settlements, reportLoads, addDriver, updateDriver, deactivateDriver } =
    useData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const importRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);

  const week = amazonWeekRangeFromAnchor(laTodayISO());

  useEffect(() => {
    if (params.get('action') === 'new') {
      openCreate();
      params.delete('action');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const rows = useMemo(() => {
    return drivers
      .map((driver) => {
        const liveStatus = deriveDriverStatus(driver, loads);
        const activeLoads = getActiveLoadsForDriver(loads, driver.id);
        const weeklyGross = getDriverAmazonGross(
          reportLoads,
          drivers,
          driver.id,
          week.start,
          week.end,
        );
        const totalLoads = reportLoadsForDriver(reportLoads, drivers, driver.id).length;
        const latestSettlement = settlements
          .filter((s) => s.driverId === driver.id)
          .sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
        return {
          driver,
          liveStatus,
          activeLoads,
          weeklyGross,
          totalLoads,
          paymentStatus: latestSettlement?.status as string | undefined,
        };
      })
      .filter((r) => !statusFilter || r.liveStatus === statusFilter)
      .filter((r) => {
        if (!search) return true;
        const q = search.toLowerCase();
        const d = r.driver;
        const name = getDriverFullName(d.firstName || '', d.lastName || '').toLowerCase();
        const id = (d.driverId || '').toLowerCase();
        const email = (d.email || '').toLowerCase();
        const phone = d.phone || '';
        const notes = (d.notes || '').toLowerCase();
        return (
          name.includes(q) ||
          id.includes(q) ||
          email.includes(q) ||
          phone.includes(q) ||
          notes.includes(q)
        );
      });
  }, [drivers, loads, settlements, reportLoads, search, statusFilter, week]);

  const sorted = useSort(rows, sortKey, sortDir, {
    name: (r) => getDriverFullName(r.driver.firstName, r.driver.lastName),
    weeklyGross: (r) => r.weeklyGross,
    totalLoads: (r) => r.totalLoads,
    hireDate: (r) => r.driver.hireDate,
    status: (r) => r.liveStatus,
  });

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const openCreate = () => {
    setEditing(null);
    const maxNum = drivers.reduce((max, d) => {
      const m = /^DRV-(\d+)$/i.exec(d.driverId);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 1000);
    setForm({
      ...emptyForm,
      driverId: `DRV-${maxNum + 1}`,
    });
    setFormOpen(true);
  };

  const openEdit = (driver: Driver) => {
    setEditing(driver);
    setForm({
      driverId: driver.driverId,
      firstName: driver.firstName,
      lastName: driver.lastName,
      phone: driver.phone,
      email: driver.email,
      status: driver.status,
      assignedTruck: driver.assignedTruck,
      trailerId: driver.trailerId,
      hireDate: driver.hireDate,
      notes: driver.notes,
      address: driver.address,
      city: driver.city,
      state: driver.state,
      zip: driver.zip,
      licenseNumber: driver.licenseNumber,
      licenseExpiry: driver.licenseExpiry,
    });
    setFormOpen(true);
  };

  const save = () => {
    if (!form.firstName || !form.lastName || !form.driverId) return;
    if (editing) updateDriver(editing.id, form);
    else addDriver(form);
    setFormOpen(false);
  };

  const exportCSV = () => {
    downloadCSV(
      'drivers.csv',
      ['driver_id', 'first_name', 'last_name', 'phone', 'email', 'status', 'tractor', 'trailer_id', 'hire_date', 'Loads', 'Weekly Gross'],
      sorted.map((r) => [
        r.driver.driverId,
        r.driver.firstName,
        r.driver.lastName,
        r.driver.phone,
        r.driver.email,
        r.liveStatus,
        r.driver.assignedTruck,
        r.driver.trailerId,
        r.driver.hireDate,
        r.totalLoads,
        r.weeklyGross,
      ])
    );
  };

  const importDrivers = async (file: File) => {
    const text = await file.text();
    const rows = csvToObjects(text);
    let added = 0;
    let skipped = 0;
    rows.forEach((row, i) => {
      const mapped = mapDriverCsvRow(row, drivers.length + i);
      if (!mapped) {
        skipped += 1;
        return;
      }
      const exists = drivers.some(
        (d) =>
          d.driverId.toLowerCase() === mapped.driverId.toLowerCase() ||
          (d.firstName.toLowerCase() === mapped.firstName.toLowerCase() &&
            d.lastName.toLowerCase() === mapped.lastName.toLowerCase()),
      );
      if (exists) {
        skipped += 1;
        return;
      }
      addDriver({
        ...mapped,
        status: (STATUSES.includes(mapped.status as DriverStatus)
          ? mapped.status
          : 'Available') as DriverStatus,
      });
      added += 1;
    });
    toast.success(`Imported ${added} drivers${skipped ? ` · skipped ${skipped}` : ''}`);
  };

  return (
    <div>
      <PageHeader
        title="Drivers"
        subtitle={`${drivers.length} drivers · status from live trips/loads (On Load when In Transit / Booked)`}
        actions={
          <>
            <input
              ref={importRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importDrivers(f);
                e.target.value = '';
              }}
            />
            <Button variant="outline" size="sm" onClick={() => importRef.current?.click()}>
              <Upload className="h-4 w-4" /> Import
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add Driver
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search drivers..." className="w-64" />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr className="border-b border-border bg-bg/80">
                <SortHeader label="Driver" sortKey="name" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">ID</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Phone</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Email</th>
                <SortHeader label="Status" sortKey="status" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Truck</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Trailer</th>
                <SortHeader label="Hire Date" sortKey="hireDate" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Loads" sortKey="totalLoads" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Weekly Gross" sortKey="weeklyGross" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Payment</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.driver.id} className="border-b border-border/60 table-row-hover">
                  <td className="px-3 py-2.5">
                    <Link to={`/drivers/${r.driver.id}`} className="font-medium text-primary hover:underline">
                      {getDriverFullName(r.driver.firstName, r.driver.lastName)}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-text-secondary">{r.driver.driverId}</td>
                  <td className="px-3 py-2.5 text-xs">{r.driver.phone || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-text-secondary">{r.driver.email || '—'}</td>
                  <td className="px-3 py-2.5">
                    <Badge status={r.liveStatus} />
                    {r.activeLoads[0] && (
                      <div className="mt-0.5 text-[10px] text-text-secondary tabular-nums">
                        {r.activeLoads[0].loadId}
                        {r.activeLoads.length > 1 ? ` +${r.activeLoads.length - 1}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs">{r.driver.assignedTruck || '—'}</td>
                  <td className="px-3 py-2.5 text-xs">{r.driver.trailerId || '—'}</td>
                  <td className="px-3 py-2.5 text-xs">{formatDate(r.driver.hireDate || null, 'MMM d, yyyy')}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.totalLoads}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatCurrency(r.weeklyGross)}</td>
                  <td className="px-3 py-2.5">
                    {r.paymentStatus ? <Badge status={r.paymentStatus} /> : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/drivers/${r.driver.id}`)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(r.driver)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {r.liveStatus !== 'Inactive' && r.driver.status !== 'Inactive' && (
                        <Button variant="ghost" size="sm" onClick={() => setDeactivateId(r.driver.id)}>
                          <UserX className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit Driver' : 'Add Driver'}
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? 'Save Changes' : 'Add Driver'}</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Driver ID"><Input value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })} /></Field>
          <Field label="First Name"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
          <Field label="Last Name"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as DriverStatus })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Assigned Truck"><Input value={form.assignedTruck} onChange={(e) => setForm({ ...form, assignedTruck: e.target.value })} /></Field>
          <Field label="Trailer ID"><Input value={form.trailerId} onChange={(e) => setForm({ ...form, trailerId: e.target.value })} /></Field>
          <Field label="Hire Date"><Input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} /></Field>
          <Field label="License Number"><Input value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} /></Field>
          <Field label="License Expiry"><Input type="date" value={form.licenseExpiry} onChange={(e) => setForm({ ...form, licenseExpiry: e.target.value })} /></Field>
          <Field label="Address"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Field label="State"><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></Field>
          <Field label="ZIP"><Input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2 lg:col-span-3">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deactivateId}
        onClose={() => setDeactivateId(null)}
        onConfirm={() => deactivateId && deactivateDriver(deactivateId)}
        title="Deactivate Driver"
        message="This will set the driver's status to Inactive. Historical loads and settlements are preserved."
        confirmLabel="Deactivate"
        danger
      />
    </div>
  );
}
