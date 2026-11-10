import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DateRangeFilter } from '@/components/ui/DateRangeFilter';
import { KpiCard } from '@/components/ui/KpiCard';
import {
  getFleetGross,
  getEligibleLoads,
  dailyRevenueSeries,
  topDriversByGross,
  groupLoadsByStatus,
} from '@/lib/calculations';
import {
  formatCurrency,
  formatDate,
  downloadCSV,
  getDateRangeFromPreset,
  getDriverFullName,
} from '@/lib/utils';
import type { DatePreset, DateRange } from '@/types';
import { toast } from 'sonner';

export function ReportsPage() {
  const { loads, drivers, settlements } = useData();
  const [preset, setPreset] = useState<DatePreset>('this_month');
  const [customRange, setCustomRange] = useState<DateRange>({
    start: '2026-11-01',
    end: '2026-11-10',
  });
  const range = getDateRangeFromPreset(preset, customRange);

  const eligible = getEligibleLoads(loads, undefined, range);
  const fleetGross = getFleetGross(loads, range);
  const avgPerLoad = eligible.length ? fleetGross / eligible.length : 0;
  const statusDist = groupLoadsByStatus(
    loads.filter((l) => l.pickupDate >= range.start && l.pickupDate <= range.end)
  );
  const completionRate = (() => {
    const total = Object.values(statusDist).reduce((a, b) => a + b, 0);
    const completed = (statusDist['Completed'] ?? 0) + (statusDist['Delivered'] ?? 0);
    return total ? (completed / total) * 100 : 0;
  })();

  const daily = dailyRevenueSeries(loads, range);
  const topDrivers = topDriversByGross(drivers, loads, range, 10);

  const periodSettlements = settlements.filter(
    (s) => s.weekStart >= range.start && s.weekStart <= range.end
  );
  const totalDeductions = periodSettlements.reduce((s, x) => s + x.totalDeductions, 0);
  const totalNet = periodSettlements.reduce((s, x) => s + x.netPayable, 0);
  const outstanding = periodSettlements.reduce(
    (s, x) => s + Math.max(0, x.netPayable - x.amountPaid),
    0
  );

  const deductionByDriver = useMemo(() => {
    const map = new Map<string, { name: string; deductions: number; net: number; gross: number }>();
    for (const s of periodSettlements) {
      const d = drivers.find((x) => x.id === s.driverId);
      if (!d) continue;
      const name = getDriverFullName(d.firstName, d.lastName);
      const cur = map.get(s.driverId) ?? { name, deductions: 0, net: 0, gross: 0 };
      cur.deductions += s.totalDeductions;
      cur.net += s.netPayable;
      cur.gross += s.weeklyGross;
      map.set(s.driverId, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.gross - a.gross);
  }, [periodSettlements, drivers]);

  const exportFleet = () => {
    downloadCSV(
      'fleet-revenue-report.csv',
      ['Date', 'Gross Revenue'],
      daily.map((d) => [d.date, d.gross])
    );
    toast.success('Fleet revenue exported');
  };

  const exportDrivers = () => {
    downloadCSV(
      'driver-comparison.csv',
      ['Driver', 'Gross', 'Loads', 'Avg/Load', 'Deductions', 'Net'],
      topDrivers.map((t) => {
        const ded = deductionByDriver.find((d) => d.name === getDriverFullName(t.driver.firstName, t.driver.lastName));
        return [
          getDriverFullName(t.driver.firstName, t.driver.lastName),
          t.gross,
          t.loads,
          t.avg,
          ded?.deductions ?? 0,
          ded?.net ?? 0,
        ];
      })
    );
    toast.success('Driver comparison exported');
  };

  const exportPayments = () => {
    downloadCSV(
      'payment-history.csv',
      ['Driver', 'Week Start', 'Gross', 'Deductions', 'Net', 'Paid', 'Balance', 'Status'],
      periodSettlements.map((s) => {
        const d = drivers.find((x) => x.id === s.driverId);
        return [
          d ? getDriverFullName(d.firstName, d.lastName) : s.driverId,
          s.weekStart,
          s.weeklyGross,
          s.totalDeductions,
          s.netPayable,
          s.amountPaid,
          s.netPayable - s.amountPaid,
          s.status,
        ];
      })
    );
    toast.success('Payment history exported');
  };

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Fleet revenue, driver comparisons, and payment analytics"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportFleet}>
              <Download className="h-4 w-4" /> Fleet CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportDrivers}>
              <FileSpreadsheet className="h-4 w-4" /> Drivers CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportPayments}>
              <Download className="h-4 w-4" /> Payments CSV
            </Button>
          </div>
        }
      />

      <DateRangeFilter
        preset={preset}
        onPresetChange={setPreset}
        customRange={customRange}
        onCustomRangeChange={setCustomRange}
        className="mb-5"
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 mb-5">
        <KpiCard title="Fleet Revenue" value={fleetGross} highlight />
        <KpiCard title="Avg Revenue / Load" value={avgPerLoad} accent="info" />
        <KpiCard title="Completed Loads" value={eligible.length} format="number" accent="success" />
        <KpiCard title="Completion Rate" value={Math.round(completionRate)} format="number" subtitle={`${completionRate.toFixed(1)}%`} accent="success" />
        <KpiCard title="Total Deductions" value={totalDeductions} accent="warning" />
        <KpiCard title="Outstanding Balances" value={outstanding} accent="danger" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mb-5">
        <Card>
          <CardHeader>
            <CardTitle>Daily Fleet Revenue</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="date" tickFormatter={(v) => format(parseISO(v), 'M/d')} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v ?? 0))} labelFormatter={(l) => formatDate(String(l))} />
                <Line type="monotone" dataKey="gross" stroke="#174A8B" strokeWidth={2} name="Gross" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Driver Gross Comparison</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topDrivers.map((t) => ({
                name: t.driver.firstName,
                gross: t.gross,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v ?? 0))} />
                <Bar dataKey="gross" fill="#2878D0" radius={[4, 4, 0, 0]} name="Gross" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mb-5">
        <Card>
          <CardHeader>
            <CardTitle>Driver Deductions & Net Pay</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deductionByDriver.slice(0, 8).map((d) => ({
                name: d.name.split(' ')[0],
                deductions: d.deductions,
                net: d.net,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v ?? 0))} />
                <Legend />
                <Bar dataKey="deductions" fill="#F59E0B" name="Deductions" radius={[4, 4, 0, 0]} />
                <Bar dataKey="net" fill="#22C55E" name="Net Pay" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment History & Outstanding</CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">Driver</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary">Net</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary">Paid</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary">Balance</th>
                </tr>
              </thead>
              <tbody>
                {periodSettlements.slice(0, 20).map((s) => {
                  const d = drivers.find((x) => x.id === s.driverId);
                  const bal = s.netPayable - s.amountPaid;
                  return (
                    <tr key={s.id} className="border-b border-border/60">
                      <td className="px-3 py-2 text-xs">
                        {d ? getDriverFullName(d.firstName, d.lastName) : '—'}
                        <div className="text-text-secondary">{formatDate(s.weekStart, 'MMM d')}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(s.netPayable)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-success">{formatCurrency(s.amountPaid)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${bal > 0 ? 'text-warning' : 'text-success'}`}>
                        {formatCurrency(Math.max(0, bal))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Load Completion Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(statusDist).map(([status, count]) => (
              <div key={status} className="rounded-lg border border-border bg-bg p-3 text-center">
                <p className="text-2xl font-bold font-display text-text">{count}</p>
                <p className="text-xs text-text-secondary mt-1">{status}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-text-secondary">
            Net payments this period: <strong className="text-text">{formatCurrency(totalNet)}</strong>
            {' · '}
            Period: {formatDate(range.start)} – {formatDate(range.end)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
