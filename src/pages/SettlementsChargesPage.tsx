import { useMemo, useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Upload } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Input, Field, Select, Textarea } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import {
  formatCurrency,
  formatDate,
  getWeekRange,
  getDriverFullName,
} from '@/lib/utils';
import { csvToObjects, mapChargeCsvRow, mapFeeCsvRow } from '@/lib/csvImport';
import { toast } from 'sonner';
import type { ChargeCategory, FeeFrequency } from '@/types';
import { format, subWeeks, parseISO } from 'date-fns';

const CATEGORIES: ChargeCategory[] = ['Fuel', 'Dispatch', 'Insurance', 'Equipment', 'ELD', 'Trailer', 'Damage', 'Other'];

function resolveDriverId(
  drivers: { id: string; driverId: string; firstName: string; lastName: string }[],
  key: string,
): string | null {
  const q = key.trim().toLowerCase();
  if (!q) return null;
  const byCode = drivers.find((d) => d.driverId.toLowerCase() === q);
  if (byCode) return byCode.id;
  const byName = drivers.find(
    (d) => getDriverFullName(d.firstName, d.lastName).toLowerCase() === q,
  );
  if (byName) return byName.id;
  const byLast = drivers.find((d) => d.lastName.toLowerCase() === q);
  return byLast?.id ?? null;
}

export function SettlementsChargesPage() {
  const {
    drivers,
    oneTimeCharges,
    driverFees,
    settlements,
    addOneTimeCharge,
    updateOneTimeCharge,
    deleteOneTimeCharge,
    addFee,
  } = useData();
  const [params, setParams] = useSearchParams();
  const feesImportRef = useRef<HTMLInputElement>(null);
  const chargesImportRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'charges' | 'settlements' | 'fees'>('charges');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    driverId: drivers[0]?.id ?? '',
    description: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    settlementWeekStart: getWeekRange(new Date()).start,
    category: 'Other' as ChargeCategory,
    notes: '',
  });

  useEffect(() => {
    if (params.get('action') === 'charge') {
      setTab('charges');
      setFormOpen(true);
      params.delete('action');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const weekOptions = useMemo(() => {
    const ref = new Date();
    return [0, 1, 2, 3].map((i) => {
      const w = getWeekRange(subWeeks(ref, i));
      return {
        value: w.start,
        label: `${format(parseISO(w.start), 'MMM d')} – ${format(parseISO(w.end), 'MMM d')}`,
      };
    });
  }, []);

  const driverMap = useMemo(
    () => Object.fromEntries(drivers.map((d) => [d.id, d])),
    [drivers]
  );

  const filteredCharges = useMemo(() => {
    const q = search.toLowerCase();
    return oneTimeCharges.filter((c) => {
      if (!q) return true;
      const d = driverMap[c.driverId];
      const name = d ? getDriverFullName(d.firstName, d.lastName).toLowerCase() : '';
      return name.includes(q) || c.description.toLowerCase().includes(q);
    });
  }, [oneTimeCharges, search, driverMap]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      driverId: drivers[0]?.id ?? '',
      description: '',
      amount: '',
      date: new Date().toISOString().slice(0, 10),
      settlementWeekStart: getWeekRange(new Date()).start,
      category: 'Other',
      notes: '',
    });
    setFormOpen(true);
  };

  const importFeesCsv = async (file: File) => {
    const rows = csvToObjects(await file.text());
    let added = 0;
    let skipped = 0;
    for (const row of rows) {
      const mapped = mapFeeCsvRow(row);
      if (!mapped) {
        skipped += 1;
        continue;
      }
      const driverId = resolveDriverId(drivers, mapped.driverKey);
      if (!driverId) {
        skipped += 1;
        continue;
      }
      addFee({
        driverId,
        feeName: mapped.feeName,
        category: (CATEGORIES.includes(mapped.category as ChargeCategory)
          ? mapped.category
          : 'Dispatch') as ChargeCategory,
        calculationType: mapped.calculationType,
        amount: mapped.amount,
        frequency: (['Per Load', 'Daily', 'Weekly', 'Monthly'].includes(mapped.frequency)
          ? mapped.frequency
          : 'Weekly') as FeeFrequency,
        active: mapped.active,
        startDate: mapped.startDate,
        endDate: mapped.endDate,
        description: mapped.description,
      });
      added += 1;
    }
    toast.success(`Imported ${added} fee rows${skipped ? ` · skipped ${skipped}` : ''}`);
  };

  const importChargesCsv = async (file: File) => {
    const rows = csvToObjects(await file.text());
    let added = 0;
    let skipped = 0;
    for (const row of rows) {
      const mapped = mapChargeCsvRow(row);
      if (!mapped) {
        skipped += 1;
        continue;
      }
      const driverId = resolveDriverId(drivers, mapped.driverKey);
      if (!driverId) {
        skipped += 1;
        continue;
      }
      addOneTimeCharge({
        driverId,
        description: mapped.description,
        amount: mapped.amount,
        date: mapped.date,
        settlementWeekStart: mapped.settlementWeekStart,
        category: (CATEGORIES.includes(mapped.category as ChargeCategory)
          ? mapped.category
          : 'Other') as ChargeCategory,
        notes: mapped.notes,
      });
      added += 1;
    }
    toast.success(`Imported ${added} weekly charges${skipped ? ` · skipped ${skipped}` : ''}`);
  };

  const openEdit = (id: string) => {
    const c = oneTimeCharges.find((x) => x.id === id);
    if (!c) return;
    setEditingId(id);
    setForm({
      driverId: c.driverId,
      description: c.description,
      amount: String(c.amount),
      date: c.date,
      settlementWeekStart: c.settlementWeekStart,
      category: c.category,
      notes: c.notes,
    });
    setFormOpen(true);
  };

  const save = () => {
    if (!form.description || !form.amount || !form.driverId) return;
    const data = {
      driverId: form.driverId,
      description: form.description,
      amount: Number(form.amount),
      date: form.date,
      settlementWeekStart: form.settlementWeekStart,
      category: form.category,
      notes: form.notes,
    };
    if (editingId) updateOneTimeCharge(editingId, data);
    else addOneTimeCharge(data);
    setFormOpen(false);
  };

  // Check if charge's settlement is finalized
  const isLocked = (charge: { driverId: string; settlementWeekStart: string }) => {
    const s = settlements.find(
      (x) => x.driverId === charge.driverId && x.weekStart === charge.settlementWeekStart
    );
    return s?.finalized ?? false;
  };

  return (
    <div>
      <PageHeader
        title="Settlements & Charges"
        subtitle="Import driver percentages + weekly charges for salary calc · settlement overview"
        actions={
          <>
            <input
              ref={feesImportRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFeesCsv(f);
                e.target.value = '';
              }}
            />
            <input
              ref={chargesImportRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importChargesCsv(f);
                e.target.value = '';
              }}
            />
            <Button variant="outline" size="sm" onClick={() => feesImportRef.current?.click()}>
              <Upload className="h-4 w-4" /> Import % fees
            </Button>
            <Button variant="outline" size="sm" onClick={() => chargesImportRef.current?.click()}>
              <Upload className="h-4 w-4" /> Import weekly charges
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add One-Time Charge
            </Button>
          </>
        }
      />

      <div className="mb-4 flex gap-1 border-b border-border">
        {[
          { key: 'charges' as const, label: 'One-Time Charges' },
          { key: 'fees' as const, label: `Percentages / Fees (${driverFees.length})` },
          { key: 'settlements' as const, label: 'All Settlements' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'charges' && (
        <>
          <Card className="mb-4 p-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search charges..." className="w-64" />
          </Card>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg/80">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Driver</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Description</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Category</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Amount</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Date</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Settlement Week</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Notes</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCharges.map((c) => {
                  const d = driverMap[c.driverId];
                  const locked = isLocked(c);
                  return (
                    <tr key={c.id} className="border-b border-border/60 table-row-hover">
                      <td className="px-3 py-2.5 font-medium">
                        {d ? (
                          <Link to={`/drivers/${d.id}`} className="text-primary hover:underline">
                            {getDriverFullName(d.firstName, d.lastName)}
                          </Link>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2.5">{c.description}</td>
                      <td className="px-3 py-2.5"><Badge status={c.category} /></td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-danger">
                        −{formatCurrency(c.amount)}
                      </td>
                      <td className="px-3 py-2.5 text-xs">{formatDate(c.date)}</td>
                      <td className="px-3 py-2.5 text-xs">{formatDate(c.settlementWeekStart, 'MMM d, yyyy')}</td>
                      <td className="px-3 py-2.5 text-xs text-text-secondary">{c.notes || '—'}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" disabled={locked} onClick={() => openEdit(c.id)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" disabled={locked} onClick={() => setDeleteId(c.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-danger" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {tab === 'fees' && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg/80">
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Driver</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Fee</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Type</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Amount</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Frequency</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Active</th>
              </tr>
            </thead>
            <tbody>
              {driverFees.map((f) => {
                const d = driverMap[f.driverId];
                return (
                  <tr key={f.id} className="border-b border-border/60 table-row-hover">
                    <td className="px-3 py-2.5 font-medium">
                      {d ? getDriverFullName(d.firstName, d.lastName) : f.driverId}
                    </td>
                    <td className="px-3 py-2.5">{f.feeName}</td>
                    <td className="px-3 py-2.5 text-xs">{f.calculationType}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {f.calculationType === 'Percentage' ? `${f.amount}%` : formatCurrency(f.amount)}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{f.frequency}</td>
                    <td className="px-3 py-2.5">{f.active ? 'Yes' : 'No'}</td>
                  </tr>
                );
              })}
              {driverFees.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-text-secondary">
                    No fees yet — use Import % fees (CSV: driver_id, percent, fee_name, frequency).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'settlements' && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg/80">
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Driver</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Week</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Gross</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Deductions</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Net</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Paid</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Status</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Locked</th>
              </tr>
            </thead>
            <tbody>
              {[...settlements]
                .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
                .slice(0, 80)
                .map((s) => {
                  const d = driverMap[s.driverId];
                  return (
                    <tr key={s.id} className="border-b border-border/60 table-row-hover">
                      <td className="px-3 py-2.5">
                        <Link to={`/payments/${s.id}`} className="font-medium text-primary hover:underline">
                          {d ? getDriverFullName(d.firstName, d.lastName) : s.driverId}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {formatDate(s.weekStart, 'MMM d')} – {formatDate(s.weekEnd, 'MMM d')}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(s.weeklyGross)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-danger">−{formatCurrency(s.totalDeductions)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{formatCurrency(s.netPayable)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(s.amountPaid)}</td>
                      <td className="px-3 py-2.5"><Badge status={s.status} /></td>
                      <td className="px-3 py-2.5 text-xs">{s.finalized ? 'Yes' : 'No'}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Edit One-Time Charge' : 'Add One-Time Charge'}
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save Charge</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Driver">
            <Select value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })}>
              {drivers.filter((d) => d.status !== 'Inactive').map((d) => (
                <option key={d.id} value={d.id}>{getDriverFullName(d.firstName, d.lastName)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ChargeCategory })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Amount ($)">
            <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="Settlement Period" className="sm:col-span-2">
            <Select value={form.settlementWeekStart} onChange={(e) => setForm({ ...form, settlementWeekStart: e.target.value })}>
              {weekOptions.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
            </Select>
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <p className="mt-3 text-xs text-text-secondary">
          One-time charges apply only to the selected driver and settlement week. They never auto-repeat.
        </p>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteOneTimeCharge(deleteId)}
        title="Remove Charge"
        message="Remove this one-time charge? Only allowed before the settlement is finalized."
        confirmLabel="Remove"
        danger
      />
    </div>
  );
}
