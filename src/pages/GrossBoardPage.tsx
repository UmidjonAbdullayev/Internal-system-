import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, TrendingUp, DollarSign, Users, Package } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { format, parseISO, subWeeks } from 'date-fns';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { KpiCard } from '@/components/ui/KpiCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/SearchInput';
import { Select } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Drawer';
import { SortHeader, useSort, type SortDir } from '@/components/shared/SortHeader';
import {
  getDailyGrossByWeekday,
  getDriverGross,
  getEligibleLoads,
  getFleetGross,
  getPreviousWeekRange,
  percentChange,
  getMonthRange,
  getLoadFinalGross,
  dailyRevenueSeries,
} from '@/lib/calculations';
import {
  formatCurrency,
  formatPercent,
  formatDate,
  downloadCSV,
  getWeekRange,
  getDriverFullName,
  cn,
} from '@/lib/utils';
import type { Driver, DateRange } from '@/types';

type ViewMode = 'daily' | 'weekly' | 'monthly' | 'custom';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function GrossBoardPage() {
  const { drivers, loads, grossAdjustments } = useData();
  const [view, setView] = useState<ViewMode>('weekly');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('weeklyGross');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [customRange, setCustomRange] = useState<DateRange>({
    start: '2026-11-03',
    end: '2026-11-10',
  });

  const refDate = new Date('2026-11-10');
  const thisWeek = getWeekRange(refDate);
  const lastWeek = getWeekRange(subWeeks(refDate, 1));
  const thisMonth = getMonthRange(refDate);
  const today = { start: '2026-11-10', end: '2026-11-10' };

  const activeRange: DateRange =
    view === 'monthly' ? thisMonth : view === 'custom' ? customRange : thisWeek;

  const rows = useMemo(() => {
    return drivers
      .filter((d) => d.status !== 'Inactive')
      .filter((d) => !statusFilter || d.status === statusFilter)
      .filter((d) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          getDriverFullName(d.firstName, d.lastName).toLowerCase().includes(q) ||
          d.driverId.toLowerCase().includes(q)
        );
      })
      .map((driver) => {
        const daily = getDailyGrossByWeekday(loads, driver.id, thisWeek);
        const weeklyGross = getDriverGross(loads, driver.id, thisWeek, grossAdjustments);
        const prevWeekGross = getDriverGross(
          loads,
          driver.id,
          getPreviousWeekRange(thisWeek.start),
          grossAdjustments
        );
        const monthlyGross = getDriverGross(loads, driver.id, thisMonth, grossAdjustments);
        const loadsCompleted = getEligibleLoads(loads, driver.id, thisWeek).length;
        return {
          driver,
          daily,
          weeklyGross,
          prevWeekGross,
          monthlyGross,
          loadsCompleted,
          diff: percentChange(weeklyGross, prevWeekGross),
        };
      });
  }, [drivers, loads, grossAdjustments, search, statusFilter, thisWeek, thisMonth]);

  const sorted = useSort(rows, sortKey, sortDir, {
    name: (r) => getDriverFullName(r.driver.firstName, r.driver.lastName),
    weeklyGross: (r) => r.weeklyGross,
    prevWeekGross: (r) => r.prevWeekGross,
    monthlyGross: (r) => r.monthlyGross,
    loadsCompleted: (r) => r.loadsCompleted,
    diff: (r) => r.diff,
  });

  const totals = useMemo(() => {
    const daily = [0, 0, 0, 0, 0, 0, 0];
    let weekly = 0;
    let prev = 0;
    let monthly = 0;
    let loadsCompleted = 0;
    for (const r of rows) {
      r.daily.forEach((v, i) => (daily[i] += v));
      weekly += r.weeklyGross;
      prev += r.prevWeekGross;
      monthly += r.monthlyGross;
      loadsCompleted += r.loadsCompleted;
    }
    return {
      daily: daily.map((v) => Math.round(v * 100) / 100),
      weekly: Math.round(weekly * 100) / 100,
      prev: Math.round(prev * 100) / 100,
      monthly: Math.round(monthly * 100) / 100,
      loadsCompleted,
      avg: rows.length ? Math.round((weekly / rows.length) * 100) / 100 : 0,
    };
  }, [rows]);

  const kpis = {
    fleetGross: getFleetGross(loads, activeRange),
    todayGross: getFleetGross(loads, today),
    weekGross: getFleetGross(loads, thisWeek),
    lastWeekGross: getFleetGross(loads, lastWeek),
    monthGross: getFleetGross(loads, thisMonth),
  };

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const exportCSV = () => {
    downloadCSV(
      'gross-board.csv',
      ['Driver', 'ID', 'Status', 'Loads', ...DAYS, 'Weekly', 'Prev Week', 'Diff %', 'Monthly'],
      sorted.map((r) => [
        getDriverFullName(r.driver.firstName, r.driver.lastName),
        r.driver.driverId,
        r.driver.status,
        r.loadsCompleted,
        ...r.daily,
        r.weeklyGross,
        r.prevWeekGross,
        r.diff,
        r.monthlyGross,
      ])
    );
  };

  const detailLoads = selectedDriver
    ? getEligibleLoads(loads, selectedDriver.id, activeRange)
    : [];
  const detailTrend = selectedDriver
    ? dailyRevenueSeries(
        loads.filter((l) => l.driverId === selectedDriver.id),
        activeRange
      )
    : [];

  return (
    <div>
      <PageHeader
        title="Gross Board"
        subtitle="Fleet-wide driver earnings and gross revenue performance"
        badge={
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            Priority
          </span>
        }
        actions={
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7 mb-5">
        <KpiCard title="Total Fleet Gross" value={kpis.fleetGross} icon={DollarSign} highlight />
        <KpiCard title="Today's Gross" value={kpis.todayGross} icon={TrendingUp} accent="success" />
        <KpiCard title="This Week" value={kpis.weekGross} accent="primary" />
        <KpiCard title="Last Week" value={kpis.lastWeekGross} accent="info" />
        <KpiCard title="This Month" value={kpis.monthGross} accent="primary" />
        <KpiCard title="Avg Per Driver" value={totals.avg} accent="info" />
        <KpiCard title="Completed Loads" value={totals.loadsCompleted} format="number" icon={Package} accent="success" />
      </div>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['weekly', 'daily', 'monthly', 'custom'] as ViewMode[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                view === v ? 'bg-primary text-white' : 'bg-white border border-border text-text-secondary hover:bg-bg'
              )}
            >
              {v === 'custom' ? 'Custom Period' : v}
            </button>
          ))}
          {view === 'custom' && (
            <>
              <input
                type="date"
                value={customRange.start}
                onChange={(e) => setCustomRange({ ...customRange, start: e.target.value })}
                className="h-8 rounded-lg border border-border px-2 text-xs"
              />
              <input
                type="date"
                value={customRange.end}
                onChange={(e) => setCustomRange({ ...customRange, end: e.target.value })}
                className="h-8 rounded-lg border border-border px-2 text-xs"
              />
            </>
          )}
          <div className="flex-1" />
          <SearchInput value={search} onChange={setSearch} placeholder="Search drivers..." className="w-52" />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36">
            <option value="">All Statuses</option>
            {['Active', 'On Load', 'Available', 'On Break', 'Suspended'].map((s) => (
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
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Status</th>
                <SortHeader label="Loads" sortKey="loadsCompleted" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                {DAYS.map((day) => (
                  <th key={day} className="px-2 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">
                    {day}
                  </th>
                ))}
                <SortHeader label="Weekly" sortKey="weeklyGross" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Prev Week" sortKey="prevWeekGross" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Diff %" sortKey="diff" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Monthly" sortKey="monthlyGross" currentKey={sortKey} direction={sortDir} onSort={handleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.driver.id}
                  className="border-b border-border/60 table-row-hover cursor-pointer"
                  onClick={() => setSelectedDriver(r.driver)}
                >
                  <td className="px-3 py-2.5">
                    <Link
                      to={`/gross-by-driver?driver=${r.driver.id}`}
                      className="font-medium text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {getDriverFullName(r.driver.firstName, r.driver.lastName)}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-text-secondary">{r.driver.driverId}</td>
                  <td className="px-3 py-2.5"><Badge status={r.driver.status} /></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.loadsCompleted}</td>
                  {r.daily.map((v, i) => (
                    <td key={i} className="px-2 py-2.5 text-right tabular-nums text-xs text-text-secondary">
                      {v > 0 ? formatCurrency(v) : '—'}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{formatCurrency(r.weeklyGross)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{formatCurrency(r.prevWeekGross)}</td>
                  <td className={cn('px-3 py-2.5 text-right tabular-nums text-xs font-medium', r.diff >= 0 ? 'text-success' : 'text-danger')}>
                    {formatPercent(r.diff)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatCurrency(r.monthlyGross)}</td>
                </tr>
              ))}
              <tr className="bg-primary/5 border-t-2 border-primary/20 font-semibold">
                <td className="px-3 py-3" colSpan={3}>
                  <span className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" /> TOTAL FLEET
                  </span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{totals.loadsCompleted}</td>
                {totals.daily.map((v, i) => (
                  <td key={i} className="px-2 py-3 text-right tabular-nums text-xs">{formatCurrency(v)}</td>
                ))}
                <td className="px-3 py-3 text-right tabular-nums text-primary">{formatCurrency(totals.weekly)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(totals.prev)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-xs">{formatPercent(percentChange(totals.weekly, totals.prev))}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(totals.monthly)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Drawer
        open={!!selectedDriver}
        onClose={() => setSelectedDriver(null)}
        title={
          selectedDriver
            ? `${getDriverFullName(selectedDriver.firstName, selectedDriver.lastName)} — Gross Detail`
            : ''
        }
        width="max-w-2xl"
      >
        {selectedDriver && (
          <div className="space-y-5 animate-fade-in">
            <div className="flex items-center gap-3">
              <Badge status={selectedDriver.status} />
              <span className="text-sm text-text-secondary">{selectedDriver.driverId}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniKpi label="Weekly" value={getDriverGross(loads, selectedDriver.id, thisWeek, grossAdjustments)} />
              <MiniKpi label="Monthly" value={getDriverGross(loads, selectedDriver.id, thisMonth, grossAdjustments)} />
              <MiniKpi label="Loads" value={detailLoads.length} currency={false} />
              <MiniKpi
                label="Avg/Load"
                value={
                  detailLoads.length
                    ? detailLoads.reduce((s, l) => s + getLoadFinalGross(l), 0) / detailLoads.length
                    : 0
                }
              />
            </div>
            <Card>
              <CardHeader><CardTitle>Gross Trend</CardTitle></CardHeader>
              <CardContent className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={detailTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="date" tickFormatter={(v) => format(parseISO(v), 'M/d')} tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => formatCurrency(Number(v ?? 0))} />
                    <Line type="monotone" dataKey="gross" stroke="#174A8B" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <div>
              <p className="text-sm font-semibold mb-2">Completed Loads ({detailLoads.length})</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {detailLoads.map((l) => (
                  <div key={l.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                    <div>
                      <p className="font-medium text-primary">{l.loadId}</p>
                      <p className="text-xs text-text-secondary">
                        {l.pickupLocation} → {l.deliveryLocation}
                      </p>
                      <p className="text-xs text-text-secondary">{formatDate(l.deliveryDate)}</p>
                    </div>
                    <p className="font-semibold tabular-nums">{formatCurrency(getLoadFinalGross(l))}</p>
                  </div>
                ))}
                {detailLoads.length === 0 && (
                  <p className="text-sm text-text-secondary text-center py-6">No eligible loads in period</p>
                )}
              </div>
            </div>
            <Link
              to={`/gross-by-driver?driver=${selectedDriver.id}`}
              className="block text-center text-sm font-medium text-secondary hover:underline"
            >
              Open full Gross by Driver report →
            </Link>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function MiniKpi({ label, value, currency = true }: { label: string; value: number; currency?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-bg p-3">
      <p className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 font-display text-base font-bold tabular-nums">
        {currency ? formatCurrency(value) : value}
      </p>
    </div>
  );
}
