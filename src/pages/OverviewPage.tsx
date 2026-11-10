import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign,
  Package,
  Users,
  CheckCircle2,
  Clock,
  Wallet,
  Building2,
  AlertTriangle,
  Truck,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { KpiCard } from '@/components/ui/KpiCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { DateRangeFilter } from '@/components/ui/DateRangeFilter';
import { Badge } from '@/components/ui/Badge';
import {
  getEligibleLoads,
  getFleetGross,
  groupLoadsByStatus,
  topDriversByGross,
  dailyRevenueSeries,
  sumGross,
} from '@/lib/calculations';
import {
  formatCurrency,
  formatDate,
  getDateRangeFromPreset,
  getDriverFullName,
} from '@/lib/utils';
import type { DatePreset, DateRange } from '@/types';

const PIE_COLORS = ['#174A8B', '#2878D0', '#4A94E0', '#22C55E', '#F59E0B', '#EF4444', '#94A3B8', '#64748B'];

export function OverviewPage() {
  const { loads, drivers, settlements, activityLogs } = useData();
  const [preset, setPreset] = useState<DatePreset>('this_week');
  const [customRange, setCustomRange] = useState<DateRange>({
    start: '2026-11-01',
    end: '2026-11-10',
  });
  const range = getDateRangeFromPreset(preset, customRange);

  const kpis = useMemo(() => {
    const eligible = getEligibleLoads(loads, undefined, range);
    const totalGross = getFleetGross(loads, range);
    const activeDrivers = drivers.filter((d) =>
      ['Active', 'On Load', 'Available', 'On Break'].includes(d.status)
    ).length;
    const completed = loads.filter(
      (l) =>
        (l.loadStatus === 'Completed' || l.loadStatus === 'Delivered') &&
        l.deliveryDate >= range.start &&
        l.deliveryDate <= range.end
    ).length;
    const pendingPayments = settlements.filter((s) =>
      ['Draft', 'Under Review', 'Approved', 'Processing', 'Partially Paid', 'On Hold'].includes(
        s.status
      )
    ).length;
    const driverEarnings = settlements
      .filter((s) => s.weekStart >= range.start && s.weekStart <= range.end)
      .reduce((sum, s) => sum + s.netPayable, 0);
    const companyFees = settlements
      .filter((s) => s.weekStart >= range.start && s.weekStart <= range.end)
      .reduce((sum, s) => sum + s.totalDeductions, 0);

    return {
      totalGross,
      totalLoads: loads.filter(
        (l) => l.pickupDate >= range.start && l.pickupDate <= range.end
      ).length,
      activeDrivers,
      completed,
      pendingPayments,
      driverEarnings,
      companyFees,
      eligibleCount: eligible.length,
    };
  }, [loads, drivers, settlements, range]);

  const chartData = useMemo(() => dailyRevenueSeries(loads, range), [loads, range]);
  const statusDist = useMemo(() => {
    const grouped = groupLoadsByStatus(
      loads.filter((l) => l.pickupDate >= range.start && l.pickupDate <= range.end)
    );
    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  }, [loads, range]);

  const topDrivers = useMemo(
    () => topDriversByGross(drivers, loads, range, 5),
    [drivers, loads, range]
  );

  const alerts = useMemo(() => {
    const items: { severity: 'danger' | 'warning' | 'info'; text: string; link: string }[] = [];
    const missingPay = loads.filter(
      (l) =>
        (l.loadStatus === 'Completed' || l.loadStatus === 'Delivered') &&
        ['Not Received', 'Pending'].includes(l.paymentStatus)
    );
    if (missingPay.length)
      items.push({
        severity: 'warning',
        text: `${missingPay.length} completed loads missing payment info`,
        link: '/loads?paymentStatus=Pending',
      });

    const pendingSettlements = settlements.filter((s) =>
      ['Draft', 'Under Review', 'Partially Paid'].includes(s.status)
    );
    if (pendingSettlements.length)
      items.push({
        severity: 'warning',
        text: `${pendingSettlements.length} drivers with pending settlements`,
        link: '/payments',
      });

    const unassigned = loads.filter(
      (l) => !l.driverId && !['Cancelled', 'Rejected', 'Available'].includes(l.loadStatus)
    );
    if (unassigned.length)
      items.push({
        severity: 'danger',
        text: `${unassigned.length} loads without assigned drivers`,
        link: '/loads',
      });

    const missingTrailer = loads.filter(
      (l) => !l.trailerId && !['Cancelled', 'Rejected', 'Available'].includes(l.loadStatus)
    );
    if (missingTrailer.length)
      items.push({
        severity: 'info',
        text: `${missingTrailer.length} loads missing trailer IDs`,
        link: '/loads',
      });

    const overdue = settlements.filter(
      (s) => s.status === 'Partially Paid' || (s.status === 'Approved' && !s.paymentDate)
    );
    if (overdue.length)
      items.push({
        severity: 'danger',
        text: `${overdue.length} overdue or incomplete payments`,
        link: '/payments',
      });

    return items;
  }, [loads, settlements]);

  return (
    <div>
      <PageHeader
        title="Operations Overview"
        subtitle="Fleet performance, load activity, and financial health at a glance"
      />

      <DateRangeFilter
        preset={preset}
        onPresetChange={setPreset}
        customRange={customRange}
        onCustomRangeChange={setCustomRange}
        className="mb-5"
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7 mb-6">
        <KpiCard title="Total Gross Revenue" value={kpis.totalGross} icon={DollarSign} accent="primary" highlight />
        <KpiCard title="Total Loads" value={kpis.totalLoads} format="number" icon={Package} accent="info" />
        <KpiCard title="Active Drivers" value={kpis.activeDrivers} format="number" icon={Users} accent="success" />
        <KpiCard title="Completed Loads" value={kpis.completed} format="number" icon={CheckCircle2} accent="success" />
        <KpiCard title="Pending Payments" value={kpis.pendingPayments} format="number" icon={Clock} accent="warning" />
        <KpiCard title="Driver Earnings" value={kpis.driverEarnings} icon={Wallet} accent="primary" />
        <KpiCard title="Company Fees" value={kpis.companyFees} icon={Building2} accent="info" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Daily Gross Revenue</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="grossGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2878D0" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2878D0" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => format(parseISO(v), 'MMM d')}
                  tick={{ fontSize: 11, fill: '#718096' }}
                />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11, fill: '#718096' }}
                />
                <Tooltip
                  formatter={(v) => formatCurrency(Number(v ?? 0))}
                  labelFormatter={(l) => formatDate(String(l))}
                />
                <Area
                  type="monotone"
                  dataKey="gross"
                  stroke="#174A8B"
                  strokeWidth={2}
                  fill="url(#grossGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Load Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusDist}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {statusDist.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap gap-2 justify-center">
              {statusDist.map((s, i) => (
                <span key={s.name} className="flex items-center gap-1 text-[10px] text-text-secondary">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  {s.name} ({s.value})
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Top Drivers by Gross</CardTitle>
            <Link to="/gross-board" className="text-xs font-medium text-secondary hover:underline">
              View Gross Board →
            </Link>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={topDrivers.map((t) => ({
                  name: t.driver.firstName,
                  gross: t.gross,
                  loads: t.loads,
                }))}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v ?? 0))} />
                <Bar dataKey="gross" fill="#174A8B" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.length === 0 && (
              <p className="text-sm text-text-secondary py-4 text-center">All clear — no alerts</p>
            )}
            {alerts.map((a, i) => (
              <Link
                key={i}
                to={a.link}
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-bg ${
                  a.severity === 'danger'
                    ? 'border-red-200 bg-danger-bg'
                    : a.severity === 'warning'
                      ? 'border-amber-200 bg-warning-bg'
                      : 'border-blue-200 bg-info-bg'
                }`}
              >
                <AlertTriangle
                  className={`h-4 w-4 shrink-0 mt-0.5 ${
                    a.severity === 'danger'
                      ? 'text-danger'
                      : a.severity === 'warning'
                        ? 'text-warning'
                        : 'text-info'
                  }`}
                />
                <span className="text-text">{a.text}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Driver Performance</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg/50">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Driver</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">Loads</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">Gross</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">Avg/Load</th>
                </tr>
              </thead>
              <tbody>
                {topDrivers.map((t) => (
                  <tr key={t.driver.id} className="border-b border-border/60 table-row-hover">
                    <td className="px-4 py-2.5">
                      <Link to={`/drivers/${t.driver.id}`} className="font-medium text-primary hover:underline">
                        {getDriverFullName(t.driver.firstName, t.driver.lastName)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{t.loads}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {formatCurrency(t.gross)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">
                      {formatCurrency(t.avg)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 max-h-72 overflow-y-auto">
            {activityLogs.slice(0, 10).map((a) => (
              <div key={a.id} className="flex gap-3">
                <div className="mt-0.5 rounded-full bg-primary/10 p-1.5 text-primary shrink-0">
                  <Truck className="h-3 w-3" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-text">{a.description}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <Badge status={a.type} />
                    <span className="text-[10px] text-text-secondary">
                      {format(parseISO(a.timestamp), 'MMM d, h:mm a')}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
