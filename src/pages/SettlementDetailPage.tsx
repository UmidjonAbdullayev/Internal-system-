import { useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Download, Printer, RefreshCw, Lock, CheckCircle, FileText,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input, Field, Select, Textarea } from '@/components/ui/Input';
import {
  getLoadFinalGross,
  remainingBalance,
} from '@/lib/calculations';
import {
  formatCurrency,
  formatDate,
  downloadCSV,
  getDriverFullName,
} from '@/lib/utils';
import { toast } from 'sonner';

export function SettlementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    getSettlement,
    getDriver,
    loads,
    recalculateSettlement,
    finalizeSettlement,
    updateSettlementStatus,
    markSettlementPaid,
    addSettlementAdjustment,
  } = useData();

  const settlement = getSettlement(id ?? '');
  const driver = settlement ? getDriver(settlement.driverId) : undefined;
  const [payOpen, setPayOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [payForm, setPayForm] = useState({
    date: '2026-11-10',
    method: 'ACH Direct Deposit',
    referenceId: '',
    amount: '',
    notes: '',
  });
  const [adjForm, setAdjForm] = useState({ description: '', amount: '', date: '2026-11-10' });

  const weekLoads = useMemo(() => {
    if (!settlement) return [];
    return loads.filter((l) => settlement.loadIds.includes(l.id));
  }, [settlement, loads]);

  if (!settlement || !driver) {
    return (
      <div className="text-center py-20">
        <p className="text-text-secondary mb-4">Settlement not found</p>
        <Button onClick={() => navigate('/payments')}>Back to Payments</Button>
      </div>
    );
  }

  const rem = remainingBalance(settlement);
  const recurring = settlement.charges.filter((c) => c.chargeType === 'Recurring');
  const oneTime = settlement.charges.filter((c) => c.chargeType === 'One-Time');

  const downloadPaycheck = () => {
    downloadCSV(
      `paycheck-${driver.driverId}-${settlement.weekStart}.csv`,
      ['Section', 'Item', 'Amount'],
      [
        ['Summary', 'Weekly Gross', settlement.weeklyGross],
        ...settlement.charges.map((c) => ['Charge', c.chargeName, -c.appliedAmount]),
        ...settlement.adjustments.map((a) => ['Adjustment', a.description, -a.amount]),
        ['Summary', 'Total Deductions', -settlement.totalDeductions],
        ['Summary', 'Net Payable', settlement.netPayable],
        ['Summary', 'Amount Paid', settlement.amountPaid],
        ['Summary', 'Remaining Balance', rem],
      ]
    );
    toast.success('Paycheck exported');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div>
      <div className="mb-4 no-print">
        <Button variant="ghost" size="sm" onClick={() => navigate('/payments')}>
          <ArrowLeft className="h-4 w-4" /> Back to Payments
        </Button>
      </div>

      <PageHeader
        title={`${getDriverFullName(driver.firstName, driver.lastName)}`}
        subtitle={`Weekly Settlement · ${format(parseISO(settlement.weekStart), 'MMMM d')} – ${format(parseISO(settlement.weekEnd), 'MMMM d, yyyy')}`}
        badge={<Badge status={settlement.status} />}
        actions={
          <div className="flex flex-wrap gap-2 no-print">
            {!settlement.finalized && (
              <Button variant="outline" size="sm" onClick={() => recalculateSettlement(settlement.id)}>
                <RefreshCw className="h-4 w-4" /> Recalculate
              </Button>
            )}
            {!settlement.finalized && (
              <Button variant="secondary" size="sm" onClick={() => finalizeSettlement(settlement.id)}>
                <Lock className="h-4 w-4" /> Approve Settlement
              </Button>
            )}
            {settlement.status !== 'Paid' && (
              <Button
                variant="success"
                size="sm"
                onClick={() => {
                  setPayForm({
                    date: '2026-11-10',
                    method: 'ACH Direct Deposit',
                    referenceId: `TXN-${Date.now().toString(36).toUpperCase()}`,
                    amount: String(rem),
                    notes: '',
                  });
                  setPayOpen(true);
                }}
              >
                <CheckCircle className="h-4 w-4" /> Mark as Paid
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={downloadPaycheck}>
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            {settlement.finalized && (
              <Button variant="outline" size="sm" onClick={() => setAdjOpen(true)}>
                <FileText className="h-4 w-4" /> Add Adjustment
              </Button>
            )}
          </div>
        }
      />

      {settlement.finalized && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-warning-bg px-4 py-2.5 text-sm text-amber-800 flex items-center gap-2">
          <Lock className="h-4 w-4" />
          This settlement is finalized. Original calculations are locked. Use adjustments for corrections.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3 mb-6">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Financial Summary</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Weekly Gross</span>
              <span className="font-bold text-lg tabular-nums">{formatCurrency(settlement.weeklyGross)}</span>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase text-text-secondary mb-2">Recurring Charges</p>
              {recurring.map((c) => (
                <div key={c.id} className="flex justify-between text-sm py-1">
                  <span>
                    {c.chargeName}
                    {c.calculationType === 'Percentage' && (
                      <span className="text-text-secondary"> ({c.originalAmountOrRate}%)</span>
                    )}
                  </span>
                  <span className="tabular-nums text-danger">−{formatCurrency(c.appliedAmount)}</span>
                </div>
              ))}
            </div>

            {oneTime.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-text-secondary mb-2">One-Time Charges</p>
                {oneTime.map((c) => (
                  <div key={c.id} className="flex justify-between text-sm py-1">
                    <span>{c.chargeName}</span>
                    <span className="tabular-nums text-danger">−{formatCurrency(c.appliedAmount)}</span>
                  </div>
                ))}
              </div>
            )}

            {settlement.adjustments.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-text-secondary mb-2">Adjustments</p>
                {settlement.adjustments.map((a) => (
                  <div key={a.id} className="flex justify-between text-sm py-1">
                    <span>{a.description}</span>
                    <span className="tabular-nums text-danger">−{formatCurrency(a.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-border pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium">Total Deductions</span>
                <span className="tabular-nums font-medium text-danger">
                  {formatCurrency(settlement.totalDeductions)}
                </span>
              </div>
              <div className="flex justify-between items-center rounded-lg bg-primary/5 p-3">
                <span className="font-display font-bold text-primary">NET PAYABLE</span>
                <span className="font-display text-xl font-bold text-primary tabular-nums">
                  {formatCurrency(settlement.netPayable)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Amount Paid</span>
                <span className="tabular-nums">{formatCurrency(settlement.amountPaid)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Remaining Balance</span>
                <span className={`tabular-nums font-semibold ${rem > 0 ? 'text-warning' : 'text-success'}`}>
                  {formatCurrency(rem)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Weekly Loads ({weekLoads.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg/50">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Load ID</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Date</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Route</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Trailer</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-text-secondary">Gross</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {weekLoads.map((l) => (
                    <tr key={l.id} className="border-b border-border/60 table-row-hover">
                      <td className="px-4 py-2">
                        <Link to="/loads" className="font-medium text-primary hover:underline">{l.loadId}</Link>
                      </td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">{formatDate(l.deliveryDate, 'MMM d')}</td>
                      <td className="px-4 py-2 text-xs">{l.pickupLocation} → {l.deliveryLocation}</td>
                      <td className="px-4 py-2 text-xs">{l.trailerId || '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">
                        {formatCurrency(getLoadFinalGross(l))}
                      </td>
                      <td className="px-4 py-2"><Badge status={l.paymentStatus} /></td>
                    </tr>
                  ))}
                  {weekLoads.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-text-secondary">
                        No eligible loads this week
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Charges and Deductions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg/50">
                <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Charge Name</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Category</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Calc Type</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-text-secondary">Rate / Amount</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-text-secondary">Applied</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Frequency</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Type</th>
              </tr>
            </thead>
            <tbody>
              {settlement.charges.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="px-4 py-2.5 font-medium">{c.chargeName}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{c.category}</td>
                  <td className="px-4 py-2.5">{c.calculationType}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {c.calculationType === 'Percentage'
                      ? `${c.originalAmountOrRate}%`
                      : formatCurrency(c.originalAmountOrRate)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-danger">
                    −{formatCurrency(c.appliedAmount)}
                  </td>
                  <td className="px-4 py-2.5">{c.frequency}</td>
                  <td className="px-4 py-2.5"><Badge status={c.chargeType} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {settlement.payments.length > 0 && (
        <Card className="mb-6">
          <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg/50">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Method</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Reference</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-text-secondary">Amount</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-text-secondary">Notes</th>
                </tr>
              </thead>
              <tbody>
                {settlement.payments.map((p) => (
                  <tr key={p.id} className="border-b border-border/60">
                    <td className="px-4 py-2">{formatDate(p.date)}</td>
                    <td className="px-4 py-2">{p.method}</td>
                    <td className="px-4 py-2 text-xs text-text-secondary">{p.referenceId}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-success">
                      {formatCurrency(p.amount)}
                    </td>
                    <td className="px-4 py-2 text-xs text-text-secondary">{p.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 no-print">
        <Button variant="outline" size="sm" onClick={() => updateSettlementStatus(settlement.id, 'Draft')}>
          Save as Draft
        </Button>
        <Button variant="outline" size="sm" onClick={() => updateSettlementStatus(settlement.id, 'Under Review')}>
          Mark Under Review
        </Button>
      </div>

      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Mark Settlement as Paid"
        footer={
          <>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button
              variant="success"
              onClick={() => {
                markSettlementPaid(settlement.id, {
                  date: payForm.date,
                  method: payForm.method,
                  referenceId: payForm.referenceId,
                  amount: Number(payForm.amount),
                  notes: payForm.notes,
                });
                setPayOpen(false);
              }}
            >
              Confirm Payment
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment Date">
            <Input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
          </Field>
          <Field label="Method">
            <Select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
              <option>ACH Direct Deposit</option>
              <option>ACH Partial</option>
              <option>Check</option>
              <option>Wire Transfer</option>
            </Select>
          </Field>
          <Field label="Reference ID">
            <Input value={payForm.referenceId} onChange={(e) => setPayForm({ ...payForm, referenceId: e.target.value })} />
          </Field>
          <Field label="Amount">
            <Input type="number" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={adjOpen}
        onClose={() => setAdjOpen(false)}
        title="Record Settlement Adjustment"
        footer={
          <>
            <Button variant="outline" onClick={() => setAdjOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!adjForm.description || !adjForm.amount) return;
                addSettlementAdjustment(settlement.id, {
                  description: adjForm.description,
                  amount: Number(adjForm.amount),
                  date: adjForm.date,
                  createdBy: 'Sarah Mitchell',
                });
                setAdjOpen(false);
                setAdjForm({ description: '', amount: '', date: '2026-11-10' });
              }}
            >
              Record Adjustment
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-text-secondary">
            Finalized settlements cannot be silently changed. Adjustments create an audit trail.
          </p>
          <Field label="Description">
            <Input value={adjForm.description} onChange={(e) => setAdjForm({ ...adjForm, description: e.target.value })} />
          </Field>
          <Field label="Amount (positive = deduction)">
            <Input type="number" step="0.01" value={adjForm.amount} onChange={(e) => setAdjForm({ ...adjForm, amount: e.target.value })} />
          </Field>
          <Field label="Date">
            <Input type="date" value={adjForm.date} onChange={(e) => setAdjForm({ ...adjForm, date: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
