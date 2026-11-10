import { useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2 } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { KpiCard } from '@/components/ui/KpiCard';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Input, Field, Select, Textarea } from '@/components/ui/Input';
import {
  getDriverGross,
  getEligibleLoads,
  getLoadFinalGross,
  getMonthRange,
} from '@/lib/calculations';
import {
  formatCurrency,
  formatDate,
  getWeekRange,
  getDriverFullName,
} from '@/lib/utils';
import type { ChargeCategory, FeeCalculationType, FeeFrequency, DriverFee } from '@/types';

const CATEGORIES: ChargeCategory[] = ['Fuel', 'Dispatch', 'Insurance', 'Equipment', 'ELD', 'Trailer', 'Damage', 'Other'];

export function DriverDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    getDriver,
    loads,
    settlements,
    driverFees,
    oneTimeCharges,
    addFee,
    updateFee,
    deleteFee,
  } = useData();

  const driver = getDriver(id ?? '');
  const [tab, setTab] = useState<'overview' | 'loads' | 'payments' | 'fees'>('overview');
  const [feeOpen, setFeeOpen] = useState(false);
  const [editingFee, setEditingFee] = useState<DriverFee | null>(null);
  const [deleteFeeId, setDeleteFeeId] = useState<string | null>(null);
  const [feeForm, setFeeForm] = useState({
    feeName: '',
    category: 'Other' as ChargeCategory,
    calculationType: 'Fixed' as FeeCalculationType,
    amount: '',
    frequency: 'Weekly' as FeeFrequency,
    active: true,
    startDate: '2026-01-01',
    endDate: '',
    description: '',
  });

  const week = getWeekRange(new Date('2026-11-10'));
  const month = getMonthRange(new Date('2026-11-10'));

  const driverLoads = useMemo(
    () => loads.filter((l) => l.driverId === id).sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate)),
    [loads, id]
  );
  const eligible = getEligibleLoads(loads, id);
  const driverSettlements = settlements
    .filter((s) => s.driverId === id)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  const fees = driverFees.filter((f) => f.driverId === id);
  const charges = oneTimeCharges.filter((c) => c.driverId === id);

  if (!driver) {
    return (
      <div className="text-center py-20">
        <p className="text-text-secondary mb-4">Driver not found</p>
        <Button onClick={() => navigate('/drivers')}>Back to Drivers</Button>
      </div>
    );
  }

  const openFeeCreate = () => {
    setEditingFee(null);
    setFeeForm({
      feeName: '',
      category: 'Other',
      calculationType: 'Fixed',
      amount: '',
      frequency: 'Weekly',
      active: true,
      startDate: '2026-01-01',
      endDate: '',
      description: '',
    });
    setFeeOpen(true);
  };

  const openFeeEdit = (fee: DriverFee) => {
    setEditingFee(fee);
    setFeeForm({
      feeName: fee.feeName,
      category: fee.category,
      calculationType: fee.calculationType,
      amount: String(fee.amount),
      frequency: fee.frequency,
      active: fee.active,
      startDate: fee.startDate,
      endDate: fee.endDate ?? '',
      description: fee.description,
    });
    setFeeOpen(true);
  };

  const saveFee = () => {
    if (!feeForm.feeName || !feeForm.amount) return;
    const data = {
      driverId: driver.id,
      feeName: feeForm.feeName,
      category: feeForm.category,
      calculationType: feeForm.calculationType,
      amount: Number(feeForm.amount),
      frequency: feeForm.frequency,
      active: feeForm.active,
      startDate: feeForm.startDate,
      endDate: feeForm.endDate || null,
      description: feeForm.description,
    };
    if (editingFee) updateFee(editingFee.id, data);
    else addFee(data);
    setFeeOpen(false);
  };

  const tabs = [
    { key: 'overview' as const, label: 'Overview' },
    { key: 'loads' as const, label: `Loads (${driverLoads.length})` },
    { key: 'payments' as const, label: `Payments (${driverSettlements.length})` },
    { key: 'fees' as const, label: `Fee Config (${fees.length})` },
  ];

  return (
    <div>
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/drivers')}>
          <ArrowLeft className="h-4 w-4" /> Back to Drivers
        </Button>
      </div>

      <PageHeader
        title={getDriverFullName(driver.firstName, driver.lastName)}
        subtitle={`${driver.driverId} · ${driver.city}, ${driver.state}`}
        badge={<Badge status={driver.status} />}
        actions={
          <>
            <Link to={`/gross-by-driver?driver=${driver.id}`}>
              <Button variant="outline" size="sm">Gross Report</Button>
            </Link>
            <Link to="/payments">
              <Button variant="outline" size="sm">Settlements</Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-5">
        <KpiCard title="Weekly Gross" value={getDriverGross(loads, driver.id, week)} highlight />
        <KpiCard title="Monthly Gross" value={getDriverGross(loads, driver.id, month)} />
        <KpiCard title="Total Loads" value={eligible.length} format="number" accent="info" />
        <KpiCard
          title="Latest Net Pay"
          value={driverSettlements[0]?.netPayable ?? 0}
          accent="success"
        />
      </div>

      <div className="mb-4 flex gap-1 border-b border-border">
        {tabs.map((t) => (
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

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2 animate-fade-in">
          <Card>
            <CardHeader><CardTitle>Personal Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Phone" value={driver.phone} />
              <Info label="Email" value={driver.email} />
              <Info label="Address" value={`${driver.address}, ${driver.city}, ${driver.state} ${driver.zip}`} />
              <Info label="Hire Date" value={formatDate(driver.hireDate)} />
              <Info label="License" value={driver.licenseNumber} />
              <Info label="License Expiry" value={formatDate(driver.licenseExpiry)} />
              <Info label="Truck" value={driver.assignedTruck || '—'} />
              <Info label="Trailer" value={driver.trailerId || '—'} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-text-secondary">
                {driver.notes || 'No notes on file.'}
              </p>
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase text-text-secondary mb-2">One-Time Charges</p>
                {charges.length === 0 && <p className="text-sm text-text-secondary">None</p>}
                {charges.map((c) => (
                  <div key={c.id} className="flex justify-between text-sm py-1 border-b border-border/50">
                    <span>{c.description}</span>
                    <span className="tabular-nums text-danger">−{formatCurrency(c.amount)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'loads' && (
        <Card className="animate-fade-in overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg/80">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Load</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Route</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Delivery</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Status</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary">Gross</th>
                </tr>
              </thead>
              <tbody>
                {driverLoads.slice(0, 50).map((l) => (
                  <tr key={l.id} className="border-b border-border/60 table-row-hover">
                    <td className="px-3 py-2 font-medium text-primary">{l.loadId}</td>
                    <td className="px-3 py-2 text-xs">{l.pickupLocation} → {l.deliveryLocation}</td>
                    <td className="px-3 py-2 text-xs">{formatDate(l.deliveryDate, 'MMM d')}</td>
                    <td className="px-3 py-2"><Badge status={l.loadStatus} /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(getLoadFinalGross(l))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'payments' && (
        <Card className="animate-fade-in overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg/80">
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Week</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary">Gross</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary">Deductions</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary">Net</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Status</th>
              </tr>
            </thead>
            <tbody>
              {driverSettlements.map((s) => (
                <tr key={s.id} className="border-b border-border/60 table-row-hover">
                  <td className="px-3 py-2">
                    <Link to={`/payments/${s.id}`} className="font-medium text-primary hover:underline">
                      {formatDate(s.weekStart, 'MMM d')} – {formatDate(s.weekEnd, 'MMM d, yyyy')}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(s.weeklyGross)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-danger">−{formatCurrency(s.totalDeductions)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(s.netPayable)}</td>
                  <td className="px-3 py-2"><Badge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'fees' && (
        <div className="animate-fade-in">
          <div className="mb-3 flex justify-end">
            <Button size="sm" onClick={openFeeCreate}>
              <Plus className="h-4 w-4" /> Add Fee
            </Button>
          </div>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg/80">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Fee Name</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Category</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Type</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Frequency</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Active</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {fees.map((f) => (
                  <tr key={f.id} className="border-b border-border/60">
                    <td className="px-3 py-2 font-medium">{f.feeName}</td>
                    <td className="px-3 py-2">{f.category}</td>
                    <td className="px-3 py-2">{f.calculationType}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {f.calculationType === 'Percentage' ? `${f.amount}%` : formatCurrency(f.amount)}
                    </td>
                    <td className="px-3 py-2">{f.frequency}</td>
                    <td className="px-3 py-2">
                      <Badge status={f.active ? 'Active' : 'Inactive'} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openFeeEdit(f)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteFeeId(f.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {fees.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-text-secondary">
                      No fee configurations. Add fees to calculate settlements.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      <Modal
        open={feeOpen}
        onClose={() => setFeeOpen(false)}
        title={editingFee ? 'Edit Fee' : 'Add Fee Configuration'}
        footer={
          <>
            <Button variant="outline" onClick={() => setFeeOpen(false)}>Cancel</Button>
            <Button onClick={saveFee}>Save Fee</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fee Name"><Input value={feeForm.feeName} onChange={(e) => setFeeForm({ ...feeForm, feeName: e.target.value })} /></Field>
          <Field label="Category">
            <Select value={feeForm.category} onChange={(e) => setFeeForm({ ...feeForm, category: e.target.value as ChargeCategory })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Calculation Type">
            <Select value={feeForm.calculationType} onChange={(e) => setFeeForm({ ...feeForm, calculationType: e.target.value as FeeCalculationType })}>
              <option value="Fixed">Fixed</option>
              <option value="Percentage">Percentage</option>
            </Select>
          </Field>
          <Field label={feeForm.calculationType === 'Percentage' ? 'Percentage' : 'Amount ($)'}>
            <Input type="number" step="0.01" value={feeForm.amount} onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })} />
          </Field>
          <Field label="Frequency">
            <Select value={feeForm.frequency} onChange={(e) => setFeeForm({ ...feeForm, frequency: e.target.value as FeeFrequency })}>
              {(['Weekly', 'Daily', 'Monthly', 'Per Load'] as FeeFrequency[]).map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </Select>
          </Field>
          <Field label="Active">
            <Select value={feeForm.active ? 'yes' : 'no'} onChange={(e) => setFeeForm({ ...feeForm, active: e.target.value === 'yes' })}>
              <option value="yes">Active</option>
              <option value="no">Inactive</option>
            </Select>
          </Field>
          <Field label="Start Date"><Input type="date" value={feeForm.startDate} onChange={(e) => setFeeForm({ ...feeForm, startDate: e.target.value })} /></Field>
          <Field label="End Date (optional)"><Input type="date" value={feeForm.endDate} onChange={(e) => setFeeForm({ ...feeForm, endDate: e.target.value })} /></Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea value={feeForm.description} onChange={(e) => setFeeForm({ ...feeForm, description: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteFeeId}
        onClose={() => setDeleteFeeId(null)}
        onConfirm={() => deleteFeeId && deleteFee(deleteFeeId)}
        title="Delete Fee"
        message="Remove this fee configuration? Finalized settlements keep their fee snapshots."
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
      <p className="font-medium">{value}</p>
    </div>
  );
}
