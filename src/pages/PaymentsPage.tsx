import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Download,
  DollarSign,
  Wallet,
  Clock,
  AlertTriangle,
  Eye,
  RefreshCw,
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
  roundMoney,
} from '@/lib/utils';
import {
  excludeFixtureInvoices,
  groupInvoicesByWeek,
  normalizeTourId,
} from '@/lib/invoiceMoney';
import { format, subWeeks, parseISO } from 'date-fns';
import type { Settlement } from '@/types';

export function PaymentsPage() {
  const {
    drivers,
    settlements,
    invoices,
    invoiceTrips,
    paymentsSummary,
    relayTrips,
    dataReady,
    dataError,
    refreshData,
    markSettlementPaid,
    getOrCreateSettlement,
  } = useData();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'invoices' | 'settlements'>('invoices');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [weekStart, setWeekStart] = useState(getWeekRange(new Date()).start);
  const [sortKey, setSortKey] = useState('week');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const handleSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };
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
    [drivers],
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

  const liveInvoices = useMemo(() => excludeFixtureInvoices(invoices), [invoices]);
  const liveInvoiceTrips = useMemo(
    () => excludeFixtureInvoices(invoiceTrips),
    [invoiceTrips],
  );

  const weekGroups = useMemo(() => {
    const groups = groupInvoicesByWeek(liveInvoices);
    const q = search.toLowerCase().trim();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.weekLabel.toLowerCase().includes(q) ||
        g.invoices.some(
          (i) =>
            i.invoiceId.toLowerCase().includes(q) ||
            i.status.toLowerCase().includes(q) ||
            String(i.amount).includes(q),
        ),
    );
  }, [liveInvoices, search]);

  const sortedWeeks = useSort(weekGroups, sortKey, sortDir, {
    week: (g) => g.year * 100 + g.week,
    total: (g) => g.total,
    status: (g) => g.status,
    invoices: (g) => g.invoices.length,
  });

  const invoiceKpis = useMemo(() => {
    const total = roundMoney(liveInvoices.reduce((s, i) => s + i.amount, 0));
    const pending = liveInvoices.filter((i) => i.status === 'Pending').length;
    const paid = liveInvoices.filter((i) => i.status === 'Paid').length;
    return {
      weeks: weekGroups.length,
      invoices: liveInvoices.length,
      total,
      pending,
      paid,
      pendingAmt: paymentsSummary?.pendingInvoicePaymentAmt ?? null,
    };
  }, [liveInvoices, weekGroups.length, paymentsSummary]);

  /** Reconciliation helpers vs report_loads-equivalent: relay trip payouts for invoiced tours. */
  const reconcileWeek = (year: number, week: number) => {
    const weekInvoices = liveInvoices.filter(
      (i) => i.amazonWeekYear === year && i.amazonWeek === week,
    );
    const tourIds = new Set<string>();
    const loadIds = new Set<string>();
    for (const inv of weekInvoices) {
      for (const t of inv.tourIds) tourIds.add(normalizeTourId(t));
      for (const l of inv.loadIds) loadIds.add(l.toUpperCase());
    }
    for (const it of liveInvoiceTrips) {
      if (it.amazonWeekYear !== year || it.amazonWeek !== week) continue;
      if (it.tourId) tourIds.add(normalizeTourId(it.tourId));
      if (it.loadId) loadIds.add(it.loadId.toUpperCase());
    }

    const ourByTour = new Map<string, { payout: number; status: string }>();
    for (const t of relayTrips) {
      const id = normalizeTourId(t.tripId);
      if (!id) continue;
      ourByTour.set(id, {
        payout: Number(t.payout) || 0,
        status: String(t.status || t.executionStatus || ''),
      });
    }

    const missingInCrm: string[] = [];
    let amazonFromInvoices = roundMoney(weekInvoices.reduce((s, i) => s + i.amount, 0));
    let ourPayout = 0;
    for (const tid of tourIds) {
      const row = ourByTour.get(tid);
      if (!row) missingInCrm.push(tid);
      else ourPayout += row.payout;
    }
    // Loads without a matching tour id in our map
    for (const lid of loadIds) {
      if (tourIds.has(normalizeTourId(lid))) continue;
      if (!ourByTour.has(normalizeTourId(lid))) {
        // may still be a load-only id — flag if no trip matches
        const hit = [...ourByTour.keys()].some((k) => k === normalizeTourId(lid));
        if (!hit) missingInCrm.push(`load:${lid}`);
      }
    }

    const completedNotInvoiced = [...ourByTour.entries()]
      .filter(([tid, row]) => {
        if (tourIds.has(tid)) return false;
        return /complete|deliver/i.test(row.status);
      })
      .map(([tid]) => tid);

    return {
      amazonTotal: amazonFromInvoices,
      ourPayout: roundMoney(ourPayout),
      delta: roundMoney(ourPayout - amazonFromInvoices),
      missingInCrm: [...new Set(missingInCrm)].slice(0, 40),
      completedNotInvoiced: completedNotInvoiced.slice(0, 40),
    };
  };

  const weekSettlements = useMemo(
    () => settlements.filter((s) => s.weekStart === weekStart),
    [settlements, weekStart],
  );

  const settlementRows = weekSettlements.map((s) => {
    const cats = categorizeCharges(s.charges);
    return { settlement: s, ...cats, remaining: remainingBalance(s) };
  });

  const sortedSettlements = useSort(settlementRows, 'netPayable', 'desc', {
    driver: (r) => {
      const d = driverMap[r.settlement.driverId];
      return d ? getDriverFullName(d.firstName, d.lastName) : r.settlement.driverId;
    },
    weeklyGross: (r) => r.settlement.weeklyGross,
    netPayable: (r) => r.settlement.netPayable,
    totalDeductions: (r) => r.settlement.totalDeductions,
    status: (r) => r.settlement.status,
  });

  const settlementKpis = useMemo(() => {
    const fleetGross = weekSettlements.reduce((s, x) => s + x.weeklyGross, 0);
    const charges = weekSettlements.reduce((s, x) => s + x.totalDeductions, 0);
    const net = weekSettlements.reduce((s, x) => s + x.netPayable, 0);
    const paid = weekSettlements
      .filter((x) => x.status === 'Paid')
      .reduce((s, x) => s + x.amountPaid, 0);
    const pending = weekSettlements.filter((x) =>
      ['Pending', 'Ready'].includes(x.status),
    ).length;
    const overdue = weekSettlements.filter((x) =>
      ['Overdue', 'Partially Paid'].includes(x.status),
    ).length;
    return { fleetGross, charges, net, paid, pending, overdue };
  }, [weekSettlements]);

  const openPay = (s: Settlement) => {
    setPayModal(s);
    setPayForm({
      date: format(new Date(), 'yyyy-MM-dd'),
      method: 'ACH Direct Deposit',
      referenceId: '',
      amount: String(remainingBalance(s)),
      notes: '',
    });
  };

  const submitPay = () => {
    if (!payModal) return;
    markSettlementPaid(payModal.id, {
      date: payForm.date,
      method: payForm.method,
      referenceId: payForm.referenceId,
      amount: Number(payForm.amount) || 0,
      notes: payForm.notes,
    });
    setPayModal(null);
  };

  const exportWeeks = () => {
    downloadCSV(
      'relay-invoice-weeks.csv',
      ['Week', 'Start', 'End', 'Invoices', 'Total', 'Status', 'Date'],
      sortedWeeks.map((g) => [
        g.weekLabel,
        g.weekStart,
        g.weekEnd,
        g.invoices.length,
        g.total,
        g.status,
        g.expectedOrPaidDate || '',
      ]),
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        subtitle="Amazon Relay invoices by week + driver settlements"
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                await refreshData();
              } finally {
                setRefreshing(false);
              }
            }}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      {dataError && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {dataError}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant={tab === 'invoices' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setTab('invoices')}
        >
          Relay invoices ({liveInvoices.length})
        </Button>
        <Button
          variant={tab === 'settlements' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setTab('settlements')}
        >
          Settlements ({settlements.length})
        </Button>
      </div>

      {tab === 'invoices' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard title="Weeks" value={invoiceKpis.weeks} format="number" icon={Wallet} />
            <KpiCard
              title="Invoices"
              value={invoiceKpis.invoices}
              format="number"
              icon={DollarSign}
            />
            <KpiCard title="Invoice total" value={invoiceKpis.total} accent="success" />
            <KpiCard
              title="Pending (summary)"
              value={invoiceKpis.pendingAmt ?? invoiceKpis.pending}
              format={invoiceKpis.pendingAmt != null ? 'currency' : 'number'}
              accent="warning"
              icon={Clock}
            />
          </div>

          {paymentsSummary?.lastSyncedAt && (
            <p className="text-xs text-text-secondary">
              payments-summary synced{' '}
              {format(parseISO(paymentsSummary.lastSyncedAt), 'MMM d, HH:mm')}
              {paymentsSummary.timeZone ? ` · ${paymentsSummary.timeZone}` : ''}
              {paymentsSummary.pendingInvoicePaymentAmt != null
                ? ` · pending ${formatCurrency(paymentsSummary.pendingInvoicePaymentAmt)}`
                : ''}
            </p>
          )}

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search week or invoice…"
              />
              <Button variant="outline" size="sm" onClick={exportWeeks}>
                <Download className="h-4 w-4" />
                Export
              </Button>
            </div>

            {!dataReady ? (
              <div className="p-8 text-sm text-text-secondary">Loading invoices…</div>
            ) : dataError ? (
              <div className="space-y-2 p-8 text-sm">
                <p className="font-medium text-danger">Could not load invoices</p>
                <p className="text-danger/90 break-words">{dataError}</p>
                <p className="text-text-secondary">
                  Check Supabase RLS SELECT on public.invoices / invoice_trips, then Refresh.
                </p>
              </div>
            ) : !sortedWeeks.length ? (
              <EmptyState
                title="No Relay invoices yet"
                description="Open Amazon Relay Payments while the extension is LIVE — settlements sync every 30 minutes. FIXTURE seeds never appear here. Popup Synced without AZNG rows usually means relay-sync is missing invoice upsert."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs text-text-secondary">
                      <th className="w-8 px-3 py-2" />
                      <SortHeader
                        label="Week"
                        sortKey="week"
                        currentKey={sortKey}
                        direction={sortDir}
                        onSort={handleSort}
                      />
                      <th className="px-3 py-2">Window</th>
                      <SortHeader
                        label="Invoices"
                        sortKey="invoices"
                        currentKey={sortKey}
                        direction={sortDir}
                        onSort={handleSort}
                      />
                      <SortHeader
                        label="Total"
                        sortKey="total"
                        currentKey={sortKey}
                        direction={sortDir}
                        onSort={handleSort}
                        align="right"
                      />
                      <SortHeader
                        label="Status"
                        sortKey="status"
                        currentKey={sortKey}
                        direction={sortDir}
                        onSort={handleSort}
                      />
                      <th className="px-3 py-2">Expected / Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedWeeks.map((g) => {
                      const open = Boolean(expanded[g.key]);
                      const recon = open ? reconcileWeek(g.year, g.week) : null;
                      return (
                        <Fragment key={g.key}>
                          <tr
                            className="border-b border-border/60 table-row-hover cursor-pointer"
                            onClick={() =>
                              setExpanded((prev) => ({ ...prev, [g.key]: !prev[g.key] }))
                            }
                          >
                            <td className="px-3 py-2.5 text-text-secondary">
                              {open ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </td>
                            <td className="px-3 py-2.5 font-medium">{g.weekLabel}</td>
                            <td className="px-3 py-2.5 text-text-secondary">
                              {formatDate(g.weekStart, 'MMM d')} –{' '}
                              {formatDate(g.weekEnd, 'MMM d, yyyy')}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums">{g.invoices.length}</td>
                            <td className="px-3 py-2.5 tabular-nums font-medium">
                              {formatCurrency(g.total)}
                            </td>
                            <td className="px-3 py-2.5">
                              <Badge status={g.status} />
                            </td>
                            <td className="px-3 py-2.5 text-text-secondary">
                              {g.expectedOrPaidDate
                                ? formatDate(g.expectedOrPaidDate, 'MMM d, yyyy')
                                : '—'}
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-surface-2/40">
                              <td colSpan={7} className="px-4 py-3">
                                <div className="space-y-3">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-left text-text-secondary">
                                        <th className="py-1 pr-2">Invoice</th>
                                        <th className="py-1 pr-2">Amount</th>
                                        <th className="py-1 pr-2">Status</th>
                                        <th className="py-1 pr-2">Invoice date</th>
                                        <th className="py-1 pr-2">Expected</th>
                                        <th className="py-1 pr-2">Paid at</th>
                                        <th className="py-1 pr-2">Tours / Loads</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {g.invoices.map((inv) => (
                                        <tr key={inv.invoiceId} className="border-t border-border/40">
                                          <td className="py-1.5 pr-2 font-mono text-[11px]">
                                            {inv.invoiceId.slice(0, 18)}…
                                          </td>
                                          <td className="py-1.5 pr-2 tabular-nums">
                                            {formatCurrency(inv.amount)}
                                          </td>
                                          <td className="py-1.5 pr-2">
                                            <Badge status={inv.status} />
                                          </td>
                                          <td className="py-1.5 pr-2">
                                            {inv.invoiceDate
                                              ? formatDate(inv.invoiceDate, 'MMM d')
                                              : '—'}
                                          </td>
                                          <td className="py-1.5 pr-2">
                                            {inv.expectedPaymentDate
                                              ? formatDate(inv.expectedPaymentDate, 'MMM d')
                                              : '—'}
                                          </td>
                                          <td className="py-1.5 pr-2">
                                            {inv.paidAt
                                              ? formatDate(inv.paidAt.slice(0, 10), 'MMM d')
                                              : '—'}
                                          </td>
                                          <td className="py-1.5 pr-2 tabular-nums">
                                            {inv.tourIds.length} / {inv.loadIds.length}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>

                                  {recon && (
                                    <div className="rounded-md border border-border/50 bg-background/60 p-3 text-xs space-y-1">
                                      <p className="font-medium">Reconciliation vs Relay trips</p>
                                      <p>
                                        Invoice total {formatCurrency(recon.amazonTotal)} · Our
                                        payout on invoiced tours {formatCurrency(recon.ourPayout)} ·
                                        Δ {formatCurrency(recon.delta)}
                                      </p>
                                      <p className="text-text-secondary">
                                        (Full report_loads Amazon Paid compare lands with money
                                        accuracy PR — using live relay_trips.payout here.)
                                      </p>
                                      {recon.missingInCrm.length > 0 && (
                                        <p>
                                          <span className="text-warning">Missing in CRM:</span>{' '}
                                          {recon.missingInCrm.join(', ')}
                                        </p>
                                      )}
                                      {recon.completedNotInvoiced.length > 0 && (
                                        <p>
                                          <span className="text-warning">
                                            Completed not in any invoice:
                                          </span>{' '}
                                          {recon.completedNotInvoiced.join(', ')}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'settlements' && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Ops week">
              <Select value={weekStart} onChange={(e) => setWeekStart(e.target.value)}>
                {weekOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                for (const d of drivers.filter((x) => x.status === 'Active')) {
                  getOrCreateSettlement(d.id, weekStart);
                }
              }}
            >
              Refresh settlements
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <KpiCard title="Total Fleet Gross" value={settlementKpis.fleetGross} icon={DollarSign} highlight />
            <KpiCard title="Total Driver Charges" value={settlementKpis.charges} accent="warning" />
            <KpiCard title="Total Net Payable" value={settlementKpis.net} icon={Wallet} accent="success" />
            <KpiCard title="Paid This Week" value={settlementKpis.paid} accent="success" />
            <KpiCard
              title="Pending Payments"
              value={settlementKpis.pending}
              format="number"
              icon={Clock}
              accent="warning"
            />
            <KpiCard
              title="Overdue / Partial"
              value={settlementKpis.overdue}
              format="number"
              icon={AlertTriangle}
              accent="danger"
            />
          </div>

          <Card className="overflow-hidden">
            {!sortedSettlements.length ? (
              <EmptyState
                title="No settlements for this week"
                description="Settlements appear after drivers and loads are in CRM."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs text-text-secondary">
                      <th className="px-3 py-2">Driver</th>
                      <th className="px-3 py-2">Gross</th>
                      <th className="px-3 py-2">Deductions</th>
                      <th className="px-3 py-2">Net</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2" />
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
                              className="font-medium text-primary hover:underline"
                              onClick={() => navigate(`/payments/${r.settlement.id}`)}
                            >
                              {d
                                ? getDriverFullName(d.firstName, d.lastName)
                                : r.settlement.driverId}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {formatCurrency(r.settlement.weeklyGross)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            −{formatCurrency(r.settlement.totalDeductions)}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums font-medium">
                            {formatCurrency(r.settlement.netPayable)}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge status={r.settlement.status} />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => navigate(`/payments/${r.settlement.id}`)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {r.settlement.status !== 'Paid' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openPay(r.settlement)}
                              >
                                Pay
                              </Button>
                            )}
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
        open={Boolean(payModal)}
        onClose={() => setPayModal(null)}
        title="Record payment"
      >
        {payModal && (
          <div className="space-y-3">
            <Field label="Date">
              <Input
                type="date"
                value={payForm.date}
                onChange={(e) => setPayForm({ ...payForm, date: e.target.value })}
              />
            </Field>
            <Field label="Method">
              <Input
                value={payForm.method}
                onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
              />
            </Field>
            <Field label="Reference">
              <Input
                value={payForm.referenceId}
                onChange={(e) => setPayForm({ ...payForm, referenceId: e.target.value })}
              />
            </Field>
            <Field label="Amount">
              <Input
                type="number"
                step="0.01"
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
              />
            </Field>
            <Field label="Notes">
              <Textarea
                value={payForm.notes}
                onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
              />
            </Field>
            <p className="text-xs text-text-secondary">
              Partial payments are supported. Settlement stays Partially Paid until the full net is
              covered.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPayModal(null)}>
                Cancel
              </Button>
              <Button onClick={submitPay}>Save payment</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
