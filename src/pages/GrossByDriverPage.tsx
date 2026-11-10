import { useMemo, useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { KpiCard } from '@/components/ui/KpiCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select, Input, Field, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { DateRangeFilter } from '@/components/ui/DateRangeFilter';
import { SortHeader, useSort, type SortDir } from '@/components/shared/SortHeader';
import {
  getEligibleLoads,
  getDriverGross,
  getLoadFinalGross,
  getMonthRange,
  dailyRevenueSeries,
  computeOrRefreshSettlement,
} from '@/lib/calculations';
import {
  formatCurrency,
  formatDate,
  downloadCSV,
  getDateRangeFromPreset,
  getWeekRange,
  getDriverFullName,
} from '@/lib/utils';
import type { DatePreset, DateRange, LoadStatus } from '@/types';

export function GrossByDriverPage() {
  const {
    drivers,
    loads,
    driverFees,
    oneTimeCharges,
    grossAdjustments,
    addGrossAdjustment,
  } = useData();
  const [params] = useSearchParams();
  const [driverId, setDriverId] = useState(params.get('driver') ?? drivers[0]?.id ?? '');
  const [preset, setPreset] = useState<DatePreset>('this_week');
  const [customRange, setCustomRange] = useState<DateRange>({
    start: '2026-11-03',
    end: '2026-11-10',
  });
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('deliveryDate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');

  useEffect(() => {
    const d = params.get('driver');
    if (d) setDriverId(d);
  }, [params]);

  const range = getDateRangeFromPreset(preset, customRange);
  const driver = drivers.find((d) => d.id === driverId);
  const week = getWeekRange(new Date('2026-11-10'));
  const month = getMonthRange(new Date('2026-11-10'));

  const driverLoads = useMemo(() => {
    let list = getEligibleLoads(loads, driverId, range);
    if (statusFilter) {
      list = loads.filter(
        (l) =>
          l.driverId === driverId &&
          l.loadStatus === statusFilter &&
          l.deliveryDate >= range.start &&
          l.deliveryDate <= range.end
      );
    }
    return list;
  }, [loads, driverId, range, statusFilter]);

  const sorted = useSort(driverLoads, sortKey, sortDir, {
    loadId: (l) => l.loadId,
    deliveryDate: (l) => l.deliveryDate,
    miles: (l) => l.distanceMiles,
    gross: (l) => getLoadFinalGross(l),
  });

  const weeklyGross = getDriverGross(loads, driverId, week, grossAdjustments);
  const monthlyGross = getDriverGross(loads, driverId, month, grossAdjustments);
  const periodGross = getDriverGross(loads, driverId, range, grossAdjustments);
  const totalCharges = oneTimeCharges
    .filter((c) => c.driverId === driverId && c.date >= range.start && c.date <= range.end)
    .reduce((s, c) => s + c.amount, 0);

  const settlementPreview = computeOrRefreshSettlement(
    undefined,
    driverId,
    week.start,
    loads,
    driverFees,
    oneTimeCharges,
    grossAdjustments
  );

  const chartData = dailyRevenueSeries(
    loads.filter((l) => l.driverId === driverId),
    range
  );

  const avgGross = driverLoads.length ? periodGross / driverLoads.length : 0;

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const exportReport = () => {
    if (!driver) return;
    downloadCSV(
      `gross-${driver.driverId}.csv`,
      ['Load ID', 'Delivery', 'Pickup', 'Delivery Loc', 'Trailer', 'Miles', 'Gross', 'Additional', 'Final', 'Payment'],
      sorted.map((l) => [
        l.loadId,
        l.deliveryDate,
        l.pickupLocation,
        l.deliveryLocation,
        l.trailerId,
        l.distanceMiles,
        l.rateGross,
        l.additionalCharges,
        getLoadFinalGross(l),
        l.paymentStatus,
      ])
    );
  };

  const saveAdjustment = () => {
    if (!adjAmount || !adjReason) return;
    addGrossAdjustment({
      driverId,
      amount: Number(adjAmount),
      reason: adjReason,
      date: range.start,
    });
    setAdjOpen(false);
    setAdjAmount('');
    setAdjReason('');
  };

  if (!driver) {
    return <p className="text-text-secondary">No drivers available.</p>;
  }

  return (
    <div>
      <PageHeader
        title="Gross by Driver"
        subtitle="Driver-level financial analysis connected to Loads CRM"
        badge={
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            Priority
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setAdjOpen(true)}>
              <Plus className="h-4 w-4" /> Gross Adjustment
            </Button>
            <Button variant="outline" size="sm" onClick={exportReport}>
              <Download className="h-4 w-4" /> Export
            </Button>
          </>
        }
      />

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Selected Driver" className="w-64">
            <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              {drivers
                .filter((d) => d.status !== 'Inactive')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {getDriverFullName(d.firstName, d.lastName)} ({d.driverId})
                  </option>
                ))}
            </Select>
          </Field>
          <div className="flex items-center gap-3 pb-1">
            <Badge status={driver.status} />
            <span className="text-sm text-text-secondary">{driver.driverId}</span>
            <Link to={`/drivers/${driver.id}`} className="text-xs text-secondary hover:underline">
              View Profile →
            </Link>
          </div>
        </div>
        <DateRangeFilter
          preset={preset}
          onPresetChange={setPreset}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          className="mt-4"
        />
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 mb-5">
        <KpiCard title="Weekly Gross" value={weeklyGross} highlight />
        <KpiCard title="Monthly Gross" value={monthlyGross} />
        <KpiCard title="Total Loads" value={driverLoads.length} format="number" accent="info" />
        <KpiCard title="Avg Gross / Load" value={avgGross} accent="success" />
        <KpiCard title="Total Charges" value={totalCharges + settlementPreview.totalDeductions} accent="warning" />
        <KpiCard title="Net Payable" value={settlementPreview.netPayable} accent="primary" />
      </div>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Daily Gross — {getDriverFullName(driver.firstName, driver.lastName)}</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="date" tickFormatter={(v) => format(parseISO(v), 'MMM d')} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v) => formatCurrency(Number(v ?? 0))}
                labelFormatter={(l) => formatDate(String(l))}
              />
              <Bar dataKey="gross" fill="#2878D0" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Load Detail ({sorted.length})</CardTitle>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-40"
          >
            <option value="">Eligible Only</option>
            {(['Completed', 'Delivered', 'In Transit', 'Dispatched', 'Cancelled'] as LoadStatus[]).map(
              (s) => (
                <option key={s} value={s}>{s}</option>
              )
            )}
          </Select>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-border bg-bg/80">
                <SortHeader label="Load ID" sortKey="loadId" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Delivery" sortKey="deliveryDate" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Route</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Trailer</th>
                <SortHeader label="Miles" sortKey="miles" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Load Gross</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Additional</th>
                <SortHeader label="Final Gross" sortKey="gross" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Payment</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => (
                <tr key={l.id} className="border-b border-border/60 table-row-hover">
                  <td className="px-3 py-2.5">
                    <Link to={`/loads`} className="font-medium text-primary hover:underline">
                      {l.loadId}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{formatDate(l.deliveryDate, 'MMM d, yyyy')}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {l.pickupLocation} → {l.deliveryLocation}
                  </td>
                  <td className="px-3 py-2.5 text-xs">{l.trailerId || '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.distanceMiles}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(l.rateGross)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                    {l.additionalCharges ? formatCurrency(l.additionalCharges) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                    {formatCurrency(getLoadFinalGross(l))}
                  </td>
                  <td className="px-3 py-2.5"><Badge status={l.paymentStatus} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-primary/5 font-semibold">
                <td className="px-3 py-3" colSpan={7}>Period Total</td>
                <td className="px-3 py-3 text-right tabular-nums text-primary">
                  {formatCurrency(periodGross)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Modal
        open={adjOpen}
        onClose={() => setAdjOpen(false)}
        title="Add Manual Gross Adjustment"
        footer={
          <>
            <Button variant="outline" onClick={() => setAdjOpen(false)}>Cancel</Button>
            <Button onClick={saveAdjustment}>Add Adjustment</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Amount (use negative for deduction)">
            <Input type="number" step="0.01" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
          </Field>
          <Field label="Reason">
            <Textarea value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="e.g. Detention pay, claim adjustment..." />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
