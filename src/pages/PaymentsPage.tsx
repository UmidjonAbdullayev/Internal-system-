import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Download, DollarSign, Wallet, Clock, AlertTriangle, Eye, CheckCircle, RefreshCw,
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
import { EmptyState } from '@/components/ui/EmptyState';
import { SortHeader, useSort, type SortDir } from '@/components/shared/SortHeader';
import { categorizeCharges, remainingBalance } from '@/lib/calculations';
import {
  formatCurrency,
  formatDate,
  downloadCSV,
  getWeekRange,
  getDriverFullName,
} from '@/lib/utils';
import { format, subWeeks, parseISO } from 'date-fns';
import type { Settlement } from '@/types';

export function PaymentsPage() {
  const {
    drivers,
    settlements,
    payments,
    dataReady,
    dataError,
    refreshData,
    markSettlementPaid,
    getOrCreateSettlement,
  } = useData();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'relay' | 'settlements'>('relay');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [weekStart, setWeekStart] = useState(getWeekRange(new Date()).start);
  const [sortKey, setSortKey] = useState('paymentDate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [payModal, setPayModal] = useState<Settlement | null>(null);
  const [payForm, setPayForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    method: 'ACH Direct Deposit',
    referenceId: '',
    amount: '',
    notes: '',
  });
  const [refreshing, setRefreshing] = useState(false);

  const driverMap = useMemo(
    () => Object.fromEntries(drivers.map((d) => [d.id, d])),
    [drivers]
  );

  const weekOptions = useMemo(() => {
    const ref = new Date();
    return [0, 1, 2, 3].map((i) => {
      const w = getWeekRange(subWeeks(ref, i));
      return {
        value: w.start,
        label: `${format(parseISO(w.start), 'MMM d')} – ${format(parseISO(w.end), 'MMM d, yyyy')}`,
      };
    });
  }, []);

  const filteredPayments = useMemo(() => {
    const q = search.toLowerCase();
    return payments.filter((p) => {
      if (!q) return true;
      return (
        p.referenceId.toLowerCase().includes(q) ||
        p.amazonRefId.toLowerCase().includes(q) ||
        p.method.toLowerCase().includes(q) ||
        String(p.amount).includes(q)
      );
    });
  }, [payments, search]);

  const sortedPayments = useSort(filteredPayments, sortKey, sortDir, {
    paymentDate: (p) => p.paymentDate,
    amount: (p) => p.amount,
    method: (p) => p.method,
    referenceId: (p) => p.referenceId,
    source: (p) => p.source,
  });

  const paymentKpis = useMemo(() => {
    const total = payments.reduce((s, p) => s + p.amount, 0);
    const linked = payments.filter((p) => p.settlementId).length;
    return {
      count: payments.length,
      total,
      linked,
      unlinked: payments.length - linked,
    };
  }, [payments]);

  const allWeek = useMemo(
    () => settlements.filter((s) => s.weekStart === weekStart),
    [settlements, weekStart]
  );

  const filteredSettlements = useMemo(() => {
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

  const enriched = filteredSettlements.map((s) => {
    const cats = categorizeCharges(s.charges);
    return { settlement: s, ...cats, remaining: remainingBalance(s) };
  });

  const sortedSettlements = useSort(enriched, sortKey, sortDir, {
    name: (r) => {
      const d = driverMap[r.settlement.driverId];
      return d ? getDriverFullName(d.firstName, d.lastName) : '';
    },
    weeklyGross: (r) => r.settlement.weeklyGross,
    netPayable: (r) => r.settlement.netPayable,
    totalDeductions: (r) => r.settlement.totalDeductions,
    status: (r) => r.settlement.status,
  });

  const settlementKpis = useMemo(() => {
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
      setSortDir(key === 'name' || key === 'method' || key === 'referenceId' ? 'asc' : 'desc');
    }
  };

  const openPay = (s: Settlement) => {
    setPayModal(s);
    setPayForm({
      date: format(new Date(), 'yyyy-MM-dd'),
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

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshData();
    } finally {
      setRefreshing(false);
    }
  };

  const exportCSV = () => {
    if (tab === 'relay') {
      downloadCSV(
        'relay-payments.csv',
        ['Payment Date', 'Amount', 'Method', 'Reference', 'Amazon Ref', 'Source', 'Settlement', 'Synced'],
        sortedPayments.map((p) => [
          p.paymentDate,
          p.amount,
          p.method,
          p.referenceId,
          p.amazonRefId,
          p.source,
          p.settlementId || '',
          p.lastSynchronized || '',
        ]),
      );
      return;
    }
    downloadCSV(
      'settlements.csv',
      ['Driver', 'ID', 'Weekly Gross', 'Deductions', 'Net', 'Status', 'Paid'],
      sortedSettlements.map((r) => {
        const d = driverMap[r.settlement.driverId];
        return [
          d ? getDriverFullName(d.firstName, d.lastName) : '',
          d?.driverId ?? '',
          r.settlement.weeklyGross,
          r.settlement.totalDeductions,
          r.settlement.netPayable,
          r.settlement.status,
          r.settlement.amountPaid,
        ];
      }),
    );
  };

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Live Amazon Relay payments from Supabase + weekly driver settlements"
        badge={
          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            Live · iiyqkdjwxlnfqvlidbqr
          </span>
        }
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void onRefresh()} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4" /> Export
            </Button>
          </div>
        }
      />

      {dataError && (
        <Card className="mb-4 border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          Failed to load Supabase data: {dataError}
        </Card>
      )}

      <div className="mb-4 flex gap-2">
        <Button
          variant={tab === 'relay' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => {
            setTab('relay');
            setSortKey('paymentDate');
            setSortDir('desc');
          }}
        >
          Relay payments ({payments.length})
        </Button>
        <Button
          variant={tab === 'settlements' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => {
            setTab('settlements');
            setSortKey('weeklyGross');
            setSortDir('desc');
          }}
        >
          Settlements ({settlements.length})
        </Button>
      </div>

      {tab === 'relay' ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard title="Payment rows" value={paymentKpis.count} format="number" icon={Clock} />
            <KpiCard title="Total amount" value={paymentKpis.total} icon={DollarSign} highlight />
            <KpiCard title="Linked to settlement" value={paymentKpis.linked} format="number" accent="success" />
            <KpiCard title="Unlinked (Relay)" value={paymentKpis.unlinked} format="number" icon={Wallet} accent="warning" />
          </div>

          <Card className="mb-4 p-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search reference, amount, method..."
              className="w-72"
            />
          </Card>

          <Card className="overflow-hidden">
            {!dataReady ? (
              <div className="p-8 text-sm text-text-secondary">Loading live payments…</div>
            ) : sortedPayments.length === 0 ? (
              <EmptyState
                title="No Relay payments yet"
                description="Run the Chrome extension GO LIVE on Amazon Relay Payments to sync rows into Supabase."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-bg/80">
                      <SortHeader label="Payment date" sortKey="paymentDate" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                      <SortHeader label="Amount" sortKey="amount" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                      <SortHeader label="Method" sortKey="method" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                      <SortHeader label="Reference" sortKey="referenceId" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Amazon ref</th>
                      <SortHeader label="Source" sortKey="source" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Synced</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPayments.map((p) => (
                      <tr key={p.id} className="border-b border-border/60 table-row-hover">
                        <td className="px-3 py-2.5 tabular-nums">{formatDate(p.paymentDate)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-primary">
                          {formatCurrency(p.amount)}
                        </td>
                        <td className="px-3 py-2.5">{p.method || '—'}</td>
                        <td className="px-3 py-2.5 text-text-secondary">{p.referenceId || '—'}</td>
                        <td className="px-3 py-2.5 text-text-secondary">{p.amazonRefId || '—'}</td>
                        <td className="px-3 py-2.5">
                          <Badge status={p.source || 'manual'} />
                        </td>
                        <td className="px-3 py-2.5 text-xs text-text-secondary">
                          {p.lastSynchronized ? formatDate(p.lastSynchronized) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard title="Total Fleet Gross" value={settlementKpis.fleetGross} icon={DollarSign} highlight />
            <KpiCard title="Total Driver Charges" value={settlementKpis.charges} accent="warning" />
            <KpiCard title="Total Net Payable" value={settlementKpis.net} icon={Wallet} accent="success" />
            <KpiCard title="Paid This Week" value={settlementKpis.paid} accent="success" />
            <KpiCard title="Pending Payments" value={settlementKpis.pending} format="number" icon={Clock} accent="warning" />
            <KpiCard title="Overdue / Partial" value={settlementKpis.overdue} format="number" icon={AlertTriangle} accent="danger" />
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
            {sortedSettlements.length === 0 ? (
              <EmptyState
                title="No settlements for this week"
                description="Settlements appear after drivers and loads are in CRM. Relay payment rows are on the Relay payments tab."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-bg/80">
                      <SortHeader label="Driver" sortKey="name" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">ID</th>
                      <SortHeader label="Weekly Gross" sortKey="weeklyGross" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                      <SortHeader label="Deductions" sortKey="totalDeductions" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                      <SortHeader label="Net Payable" sortKey="netPayable" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                      <SortHeader label="Status" sortKey="status" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSettlements.map((r) => {
                      const d = driverMap[r.settlement.driverId];
                      return (
                        <tr key={r.settlement.id} className="border-b border-border/60 table-row-hover">
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              className="text-left font-medium text-primary hover:underline"
                              onClick={() => navigate(`/payments/${r.settlement.id}`)}
                            >
                              {d ? getDriverFullName(d.firstName, d.lastName) : r.settlement.driverId}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-text-secondary">{d?.driverId ?? '—'}</td>
                          <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                            {formatCurrency(r.settlement.weeklyGross)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-danger">
                            −{formatCurrency(r.settlement.totalDeductions)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold tabular-nums text-primary">
                            {formatCurrency(r.settlement.netPayable)}
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
                              {!d && drivers[0] && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => getOrCreateSettlement(drivers[0].id, weekStart)}
                                >
                                  New
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Modal
        open={!!payModal}
        onClose={() => setPayModal(null)}
        title="Record payment"
        footer={
          <>
            <Button variant="outline" onClick={() => setPayModal(null)}>Cancel</Button>
            <Button onClick={submitPay}>Save payment</Button>
          </>
        }
      >
        {payModal && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Remaining balance: <strong>{formatCurrency(remainingBalance(payModal))}</strong>
            </p>
            <Field label="Date">
              <Input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
            </Field>
            <Field label="Method">
              <Input value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} />
            </Field>
            <Field label="Reference">
              <Input value={payForm.referenceId} onChange={(e) => setPayForm({ ...payForm, referenceId: e.target.value })} />
            </Field>
            <Field label="Amount">
              <Input type="number" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
            </Field>
            <Field label="Notes">
              <Textarea value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} />
            </Field>
            <p className="text-xs text-text-secondary">
              Partial payments are supported. Settlement stays Partially Paid until the full net is covered.
              See also <Link className="text-primary underline" to="/loads">Loads</Link> for Relay load rows.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
