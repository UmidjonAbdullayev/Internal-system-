import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Download, DollarSign, Wallet, Clock, AlertTriangle, Eye, CheckCircle,
} from 'lucide-react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { KpiCard } from '@/components/ui/KpiCard';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/SearchInput';
import { Select, Input, Field, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SortHeader, useSort, type SortDir } from '@/components/shared/SortHeader';
import { categorizeCharges, remainingBalance } from '@/lib/calculations';
import {
  formatCurrency,
  formatDate,
  downloadCSV,
  getWeekRange,
  getDriverFullName,
  cn,
} from '@/lib/utils';
import { format, subWeeks, parseISO } from 'date-fns';
import type { Settlement } from '@/types';

export function PaymentsPage() {
  const { drivers, settlements, markSettlementPaid, getOrCreateSettlement } = useData();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [weekStart, setWeekStart] = useState(getWeekRange(new Date('2026-11-10')).start);
  const [sortKey, setSortKey] = useState('weeklyGross');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [payModal, setPayModal] = useState<Settlement | null>(null);
  const [payForm, setPayForm] = useState({
    date: '2026-11-10',
    method: 'ACH Direct Deposit',
    referenceId: '',
    amount: '',
    notes: '',
  });

  const driverMap = useMemo(
    () => Object.fromEntries(drivers.map((d) => [d.id, d])),
    [drivers]
  );

  const weekOptions = useMemo(() => {
    const ref = new Date('2026-11-10');
    return [0, 1, 2, 3].map((i) => {
      const w = getWeekRange(subWeeks(ref, i));
      return {
        value: w.start,
        label: `${format(parseISO(w.start), 'MMM d')} – ${format(parseISO(w.end), 'MMM d, yyyy')}`,
      };
    });
  }, []);

  // Ensure settlements exist for all active drivers for selected week
  const weekSettlements = useMemo(() => {
    const active = drivers.filter((d) => !['Inactive', 'Suspended'].includes(d.status));
    return active.map((d) => {
      const existing = settlements.find(
        (s) => s.driverId === d.id && s.weekStart === weekStart
      );
      return existing ?? null;
    }).filter(Boolean) as Settlement[];
  }, [drivers, settlements, weekStart]);

  // Also include any settlements for the week even for suspended
  const allWeek = useMemo(() => {
    const fromState = settlements.filter((s) => s.weekStart === weekStart);
    const ids = new Set(fromState.map((s) => s.id));
    // Prefer state settlements
    return fromState.length ? fromState : weekSettlements.filter((s) => !ids.has(s.id));
  }, [settlements, weekStart, weekSettlements]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allWeek.filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false;
      if (driverFilter && s.driverId !== driverFilter) return false;
      const d = driverMap[s.driverId];
      if (q && d) {
        const name = getDriverFullName(d.firstName, d.lastName).toLowerCase();
        if (!name.includes(q) && !d.driverId.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allWeek, search, statusFilter, driverFilter, driverMap]);

  const enriched = filtered.map((s) => {
    const cats = categorizeCharges(s.charges);
    return { settlement: s, ...cats, remaining: remainingBalance(s) };
  });

  const sorted = useSort(enriched, sortKey, sortDir, {
    name: (r) => {
      const d = driverMap[r.settlement.driverId];
      return d ? getDriverFullName(d.firstName, d.lastName) : '';
    },
    weeklyGross: (r) => r.settlement.weeklyGross,
    netPayable: (r) => r.settlement.netPayable,
    totalDeductions: (r) => r.settlement.totalDeductions,
    status: (r) => r.settlement.status,
  });

  const kpis = useMemo(() => {
    const list = allWeek;
    return {
      fleetGross: list.reduce((s, x) => s + x.weeklyGross, 0),
      charges: list.reduce((s, x) => s + x.totalDeductions, 0),
      net: list.reduce((s, x) => s + x.netPayable, 0),
      paid: list.filter((x) => x.status === 'Paid').reduce((s, x) => s + x.amountPaid, 0),
      pending: list.filter((x) =>
        ['Draft', 'Under Review', 'Approved', 'Processing'].includes(x.status)
      ).length,
      overdue: list.filter((x) =>
        ['Partially Paid', 'On Hold'].includes(x.status)
      ).length,
    };
  }, [allWeek]);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const openPay = (s: Settlement) => {
    setPayModal(s);
    setPayForm({
      date: '2026-11-10',
      method: 'ACH Direct Deposit',
      referenceId: `TXN-${Date.now().toString(36).toUpperCase()}`,
      amount: String(remainingBalance(s)),
      notes: '',
    });
  };

  const submitPay = () => {
    if (!payModal || !payForm.amount) return;
    markSettlementPaid(payModal.id, {
      date: payForm.date,
      method: payForm.method,
      referenceId: payForm.referenceId,
      amount: Number(payForm.amount),
      notes: payForm.notes,
    });
    setPayModal(null);
  };

  const ensureAndOpen = (driverId: string) => {
    const s = getOrCreateSettlement(driverId, weekStart);
    navigate(`/payments/${s.id}`);
  };

  const exportCSV = () => {
    downloadCSV(
      'payments.csv',
      ['Driver', 'ID', 'Weekly Gross', 'Fuel', 'Dispatch', 'Insurance', 'Equipment', 'Other', 'Deductions', 'Net', 'Status', 'Paid'],
      sorted.map((r) => {
        const d = driverMap[r.settlement.driverId];
        return [
          d ? getDriverFullName(d.firstName, d.lastName) : '',
          d?.driverId ?? '',
          r.settlement.weeklyGross,
          r.fuel,
          r.dispatch,
          r.insurance,
          r.equipment,
          r.other,
          r.settlement.totalDeductions,
          r.settlement.netPayable,
          r.settlement.status,
          r.settlement.amountPaid,
        ];
      })
    );
  };

  return (
    <div>
      <PageHeader
        title="Payments / Paycheck"
        subtitle="Weekly settlements, deductions, and net driver pay"
        badge={
          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
            Critical Workflow
          </span>
        }
        actions={
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4" /> Export
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 mb-5">
        <KpiCard title="Total Fleet Gross" value={kpis.fleetGross} icon={DollarSign} highlight />
        <KpiCard title="Total Driver Charges" value={kpis.charges} accent="warning" />
        <KpiCard title="Total Net Payable" value={kpis.net} icon={Wallet} accent="success" />
        <KpiCard title="Paid This Week" value={kpis.paid} accent="success" />
        <KpiCard title="Pending Payments" value={kpis.pending} format="number" icon={Clock} accent="warning" />
        <KpiCard title="Overdue / Partial" value={kpis.overdue} format="number" icon={AlertTriangle} accent="danger" />
      </div>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap gap-2">
          <Select value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="w-56">
            {weekOptions.map((w) => (
              <option key={w.value} value={w.value}>{w.label}</option>
            ))}
          </Select>
          <SearchInput value={search} onChange={setSearch} placeholder="Search drivers..." className="w-52" />
          <Select value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} className="w-44">
            <option value="">All Drivers</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>{getDriverFullName(d.firstName, d.lastName)}</option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
            <option value="">All Statuses</option>
            {['Draft', 'Under Review', 'Approved', 'Processing', 'Paid', 'On Hold', 'Partially Paid'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1200px]">
            <thead>
              <tr className="border-b border-border bg-bg/80">
                <SortHeader label="Driver" sortKey="name" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">ID</th>
                <SortHeader label="Weekly Gross" sortKey="weeklyGross" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Fuel Card</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Dispatch</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Insurance</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Equipment</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Other</th>
                <SortHeader label="Deductions" sortKey="totalDeductions" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Net Payable" sortKey="netPayable" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Status" sortKey="status" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const d = driverMap[r.settlement.driverId];
                if (!d) return null;
                return (
                  <tr key={r.settlement.id} className="border-b border-border/60 table-row-hover">
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline text-left"
                        onClick={() => navigate(`/payments/${r.settlement.id}`)}
                      >
                        {getDriverFullName(d.firstName, d.lastName)}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-text-secondary">{d.driverId}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                      {formatCurrency(r.settlement.weeklyGross)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{formatCurrency(r.fuel)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{formatCurrency(r.dispatch)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{formatCurrency(r.insurance)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{formatCurrency(r.equipment)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{formatCurrency(r.other)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-danger">
                      −{formatCurrency(r.settlement.totalDeductions)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold text-primary">
                      {formatCurrency(r.settlement.netPayable)}
                      {r.remaining > 0 && r.settlement.amountPaid > 0 && (
                        <div className="text-[10px] font-normal text-warning">
                          Bal: {formatCurrency(r.remaining)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5"><Badge status={r.settlement.status} /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/payments/${r.settlement.id}`)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {r.settlement.status !== 'Paid' && (
                          <Button variant="ghost" size="sm" onClick={() => openPay(r.settlement)}>
                            <CheckCircle className="h-3.5 w-3.5 text-success" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-primary/5 font-semibold border-t-2 border-primary/20">
                <td className="px-3 py-3" colSpan={2}>TOTAL</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(kpis.fleetGross)}</td>
                <td colSpan={5} />
                <td className="px-3 py-3 text-right tabular-nums text-danger">−{formatCurrency(kpis.charges)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-primary">{formatCurrency(kpis.net)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {sorted.length === 0 && (
        <div className="mt-4 text-center">
          <p className="text-sm text-text-secondary mb-3">No settlements for this week yet.</p>
          <Button
            onClick={() => {
              drivers
                .filter((d) => !['Inactive', 'Suspended'].includes(d.status))
                .forEach((d) => getOrCreateSettlement(d.id, weekStart));
            }}
          >
            Generate Settlements
          </Button>
        </div>
      )}

      <Modal
        open={!!payModal}
        onClose={() => setPayModal(null)}
        title="Record Payment"
        footer={
          <>
            <Button variant="outline" onClick={() => setPayModal(null)}>Cancel</Button>
            <Button variant="success" onClick={submitPay}>Record Payment</Button>
          </>
        }
      >
        {payModal && (
          <div className="space-y-4">
            <div className="rounded-lg bg-bg p-3 text-sm space-y-1">
              <p>Net Payable: <strong>{formatCurrency(payModal.netPayable)}</strong></p>
              <p>Already Paid: <strong>{formatCurrency(payModal.amountPaid)}</strong></p>
              <p className={cn(remainingBalance(payModal) > 0 ? 'text-warning' : 'text-success')}>
                Remaining: <strong>{formatCurrency(remainingBalance(payModal))}</strong>
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Payment Date">
                <Input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
              </Field>
              <Field label="Payment Method">
                <Select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                  <option>ACH Direct Deposit</option>
                  <option>ACH Partial</option>
                  <option>Check</option>
                  <option>Wire Transfer</option>
                  <option>Cash</option>
                </Select>
              </Field>
              <Field label="Transaction / Reference ID">
                <Input value={payForm.referenceId} onChange={(e) => setPayForm({ ...payForm, referenceId: e.target.value })} />
              </Field>
              <Field label="Amount Paid">
                <Input type="number" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <Textarea value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} />
              </Field>
            </div>
            <p className="text-xs text-text-secondary">
              Partial payments are supported. Settlement stays Partially Paid until the full net is covered.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
