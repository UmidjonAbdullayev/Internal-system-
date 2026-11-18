import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, TrendingUp, DollarSign, Users, Package, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { KpiCard } from '@/components/ui/KpiCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/SearchInput';
import { Select } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { SortHeader, useSort, type SortDir } from '@/components/shared/SortHeader';
import { deriveDriverStatus, percentChange, getMonthRange } from '@/lib/calculations';
import {
  formatCurrency,
  formatPercent,
  formatDate,
  downloadCSV,
  getDriverFullName,
  cn,
} from '@/lib/utils';
import {
  amazonWeekRangeFromAnchor,
  laTodayISO,
  shiftAmazonWeek,
} from '@/lib/amazonWeek';
import {
  filterReportLoadsByWeek,
  getDailyAmazonByWeekday,
  getDriverAmazonGross,
  getFleetAmazonGross,
  matchDriverToName,
  reportLoadsForDriver,
  type ReportLoadRow,
} from '@/lib/reportLoadMoney';
import type { Driver, DateRange } from '@/types';

type ViewMode = 'daily' | 'weekly' | 'monthly' | 'custom';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function GrossBoardPage() {
  const { drivers, loads, reportLoads, grossAdjustments } = useData();
  const [view, setView] = useState<ViewMode>('weekly');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('weeklyGross');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const todayStr = laTodayISO();
  const [weekAnchor, setWeekAnchor] = useState(todayStr);
  const [customRange, setCustomRange] = useState<DateRange>(() => {
    const w = amazonWeekRangeFromAnchor(todayStr);
    return { start: w.start, end: w.end };
  });

  const thisWeek = amazonWeekRangeFromAnchor(weekAnchor);
  const lastWeekStart = shiftAmazonWeek(thisWeek.start, -1);
  const lastWeek = amazonWeekRangeFromAnchor(lastWeekStart);
  const thisMonth = getMonthRange(todayStr);
  const today = { start: todayStr, end: todayStr };

  const activeRange: DateRange =
    view === 'monthly' ? thisMonth : view === 'custom' ? customRange : { start: thisWeek.start, end: thisWeek.end };

  const rows = useMemo(() => {
    return drivers
      .filter((d) => d.status !== 'Inactive')
      .map((driver) => {
        const liveStatus = deriveDriverStatus(driver, loads);
        const daily = getDailyAmazonByWeekday(
          reportLoads,
          drivers,
          driver.id,
          thisWeek.start,
          thisWeek.end,
        );
        const weeklyGross = getDriverAmazonGross(
          reportLoads,
          drivers,
          driver.id,
          thisWeek.start,
          thisWeek.end,
          grossAdjustments,
        );
        const prevWeekGross = getDriverAmazonGross(
          reportLoads,
          drivers,
          driver.id,
          lastWeek.start,
          lastWeek.end,
          grossAdjustments,
        );
        const monthlyGross = getDriverAmazonGross(
          reportLoads,
          drivers,
          driver.id,
          thisMonth.start,
          thisMonth.end,
          grossAdjustments,
        );
        const weekLoads = reportLoadsForDriver(
          reportLoads,
          drivers,
          driver.id,
          thisWeek.start,
          thisWeek.end,
        );
        return {
          driver,
          liveStatus,
          daily,
          weeklyGross,
          prevWeekGross,
          monthlyGross,
          loadsCompleted: weekLoads.length,
          weekLoads,
          diff: percentChange(weeklyGross, prevWeekGross),
        };
      })
      .filter((r) => !statusFilter || r.liveStatus === statusFilter)
      .filter((r) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          getDriverFullName(r.driver.firstName, r.driver.lastName).toLowerCase().includes(q) ||
          r.driver.driverId.toLowerCase().includes(q)
        );
      });
  }, [drivers, loads, reportLoads, grossAdjustments, search, statusFilter, thisWeek, thisMonth, lastWeek]);

  const weeklyRoster = useMemo(() => {
    const inWeek = filterReportLoadsByWeek(reportLoads, thisWeek.start, thisWeek.end);
    return inWeek
      .map((load) => ({
        driver: matchDriverToName(drivers, load.driverName),
        load,
        pay: load.amazonPaid,
      }))
      .sort((a, b) => {
        const an = a.driver
          ? `${a.driver.lastName} ${a.driver.firstName}`
          : a.load.driverName || 'zzz';
        const bn = b.driver
          ? `${b.driver.lastName} ${b.driver.firstName}`
          : b.load.driverName || 'zzz';
        if (an !== bn) return an.localeCompare(bn);
        return (a.load.tourStartLa || '').localeCompare(b.load.tourStartLa || '');
      });
  }, [reportLoads, drivers, thisWeek]);

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
    fleetGross: getFleetAmazonGross(reportLoads, activeRange.start, activeRange.end),
    todayGross: getFleetAmazonGross(reportLoads, today.start, today.end),
    weekGross: getFleetAmazonGross(reportLoads, thisWeek.start, thisWeek.end),
    lastWeekGross: getFleetAmazonGross(reportLoads, lastWeek.start, lastWeek.end),
    monthGross: getFleetAmazonGross(reportLoads, thisMonth.start, thisMonth.end),
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
        r.liveStatus,
        r.loadsCompleted,
        ...r.daily,
        r.weeklyGross,
        r.prevWeekGross,
        r.diff,
        r.monthlyGross,
      ]),
    );
  };

  const exportWeekLoads = () => {
    downloadCSV(
      `gross-week-${thisWeek.start}.csv`,
      ['Driver', 'Driver ID', 'Tour', 'Tour start', 'Pickup', 'Delivery Loc', 'Amazon Paid', 'Week'],
      weeklyRoster.map((r) => [
        r.driver
          ? getDriverFullName(r.driver.firstName, r.driver.lastName)
          : r.load.driverName || 'Unassigned',
        r.driver?.driverId || '',
        r.load.tripDisplay,
        r.load.tourStartLa || '',
        r.load.puLocation,
        r.load.delLocation,
        r.pay,
        r.load.weekLabel,
      ]),
    );
  };

  const detailLoads: ReportLoadRow[] = selectedDriver
    ? reportLoadsForDriver(
        reportLoads,
        drivers,
        selectedDriver.id,
        activeRange.start,
        activeRange.end,
      )
    : [];
  const detailTrend = (() => {
    if (!selectedDriver) return [] as { date: string; gross: number }[];
    const map = new Map<string, number>();
    for (const l of detailLoads) {
      const key = l.tourStartLa || '';
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + l.amazonPaid);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, gross]) => ({ date, gross }));
  })();

  const shiftWeek = (delta: number) => {
    setWeekAnchor(shiftAmazonWeek(amazonWeekRangeFromAnchor(weekAnchor).start, delta));
  };

  return (
    <div>
      <PageHeader
        title="Gross Board"
        subtitle={`Amazon week ${thisWeek.label} · ${thisWeek.start} → ${thisWeek.end} (Sun–Sat LA) · report_loads`}
        badge={
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            Priority
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportWeekLoads}>
              <Download className="h-4 w-4" /> Week loads
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </>
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
                view === v ? 'bg-primary text-white' : 'bg-white border border-border text-text-secondary hover:bg-bg',
              )}
            >
              {v === 'custom' ? 'Custom Period' : v}
            </button>
          ))}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg px-1 py-0.5">
            <Button variant="ghost" size="sm" type="button" onClick={() => shiftWeek(-1)} aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2 text-xs font-medium tabular-nums whitespace-nowrap">
              {formatDate(thisWeek.start, 'MMM d')} – {formatDate(thisWeek.end, 'MMM d, yyyy')}
            </span>
            <Button variant="ghost" size="sm" type="button" onClick={() => shiftWeek(1)} aria-label="Next week">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setWeekAnchor(todayStr)}
            >
              This week
            </Button>
          </div>
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

      <Card className="mb-5 overflow-hidden">
        <CardHeader>
          <CardTitle>
            Week loads &amp; pay ({weeklyRoster.length}) — who hauled what
          </CardTitle>
        </CardHeader>
        {weeklyRoster.length === 0 ? (
          <EmptyState
            title="No tours in this Amazon week"
            description="Gross Board uses report_loads income (completed/TONU on MAIN invoice week). Expected and pending-invoice tours are excluded from week gross."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-border bg-bg/80">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Driver</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Tour</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Route</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Tour start</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-text-secondary">Amazon $</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-text-secondary">Week</th>
                </tr>
              </thead>
              <tbody>
                {weeklyRoster.map((r) => (
                  <tr key={r.load.tourId} className="border-b border-border/60 table-row-hover">
                    <td className="px-3 py-2.5">
                      {r.driver ? (
                        <Link
                          to={`/gross-by-driver?driver=${r.driver.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {getDriverFullName(r.driver.firstName, r.driver.lastName)}
                        </Link>
                      ) : (
                        <span className="text-text-secondary italic">
                          {r.load.driverName || 'Unassigned'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-medium tabular-nums">{r.load.tripDisplay}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.load.puLocation} → {r.load.delLocation}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                      {r.load.tourStartLa ? formatDate(r.load.tourStartLa, 'MMM d') : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                      {formatCurrency(r.pay)}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{r.load.weekLabel}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-primary/5 font-semibold">
                  <td className="px-3 py-3" colSpan={4}>
                    Week total ({weeklyRoster.length} tours)
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-primary">
                    {formatCurrency(weeklyRoster.reduce((s, r) => s + r.pay, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
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
                  <td className="px-3 py-2.5"><Badge status={r.liveStatus} /></td>
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
              <Badge status={deriveDriverStatus(selectedDriver, loads)} />
              <span className="text-sm text-text-secondary">{selectedDriver.driverId}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniKpi
                label="Weekly"
                value={getDriverAmazonGross(
                  reportLoads,
                  drivers,
                  selectedDriver.id,
                  thisWeek.start,
                  thisWeek.end,
                  grossAdjustments,
                )}
              />
              <MiniKpi
                label="Monthly"
                value={getDriverAmazonGross(
                  reportLoads,
                  drivers,
                  selectedDriver.id,
                  thisMonth.start,
                  thisMonth.end,
                  grossAdjustments,
                )}
              />
              <MiniKpi label="Tours" value={detailLoads.length} currency={false} />
              <MiniKpi
                label="Avg/Tour"
                value={
                  detailLoads.length
                    ? detailLoads.reduce((s, l) => s + l.amazonPaid, 0) / detailLoads.length
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
              <p className="text-sm font-semibold mb-2">Tours in period ({detailLoads.length})</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {detailLoads.map((l) => (
                  <div key={l.tourId} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                    <div>
                      <p className="font-medium text-primary">{l.tripDisplay}</p>
                      <p className="text-xs text-text-secondary">
                        {l.puLocation} → {l.delLocation}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {l.tourStartLa ? formatDate(l.tourStartLa) : '—'} · {l.weekLabel}
                      </p>
                    </div>
                    <p className="font-semibold tabular-nums">{formatCurrency(l.amazonPaid)}</p>
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
