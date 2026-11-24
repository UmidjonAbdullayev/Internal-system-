import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Download } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SortHeader, useSort, type SortDir } from '@/components/shared/SortHeader';
import { PeriodPicker } from '@/components/gross/PeriodPicker';
import { defaultPeriod, periodRange, type PeriodState } from '@/components/gross/period';
import {
  filterReportLoadsByWeek,
  getDriverResolver,
  isEarnedRow,
  isInProgressRow,
  sumAmazonPaid,
} from '@/lib/reportLoadMoney';
import { downloadCSV, formatCurrency, formatDate, getDriverFullName } from '@/lib/utils';

/**
 * Fleet list: one row per driver for the period. Money is trip-level (Amazon's tour price —
 * the parent row), never per-leg amounts. Click a driver → their own page.
 */
export function GrossByDriverPage() {
  const { drivers, reportLoads, grossAdjustments, oneTimeCharges } = useData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('earned');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const range = periodRange(period);

  const resolve = useMemo(() => getDriverResolver(drivers, reportLoads), [drivers, reportLoads]);

  const { rows, unlinkedEarned, unlinkedTours } = useMemo(() => {
    const inRange = filterReportLoadsByWeek(reportLoads, range.start, range.end);
    const byDriver = new Map<string, typeof inRange>();
    let unlinked = 0;
    let unlinkedCount = 0;
    for (const r of inRange) {
      const d = resolve(r).driver;
      if (!d) {
        if (isEarnedRow(r)) {
          unlinked += r.amazonPaid || 0;
          unlinkedCount += 1;
        }
        continue;
      }
      byDriver.set(d.id, [...(byDriver.get(d.id) || []), r]);
    }
    const out = drivers
      .filter((d) => d.status !== 'Inactive' || byDriver.has(d.id))
      .map((d) => {
        const list = byDriver.get(d.id) || [];
        const earnedRows = list.filter(isEarnedRow);
        const adj = grossAdjustments
          .filter((a) => a.driverId === d.id && a.date >= range.start && a.date <= range.end)
          .reduce((s, a) => s + a.amount, 0);
        const earned = Math.round((sumAmazonPaid(earnedRows) + adj) * 100) / 100;
        const charges = oneTimeCharges
          .filter((c) => c.driverId === d.id && c.date >= range.start && c.date <= range.end)
          .reduce((s, c) => s + c.amount, 0);
        return {
          driver: d,
          name: getDriverFullName(d.firstName, d.lastName),
          tours: earnedRows.length,
          earned,
          inProgress: sumAmazonPaid(list.filter(isInProgressRow)),
          inProgressTours: list.filter(isInProgressRow).length,
          charges,
          net: Math.round((earned - charges) * 100) / 100,
        };
      });
    return {
      rows: out,
      unlinkedEarned: Math.round(unlinked * 100) / 100,
      unlinkedTours: unlinkedCount,
    };
  }, [reportLoads, drivers, resolve, range.start, range.end, grossAdjustments, oneTimeCharges]);

  const filtered = rows.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()));
  const sorted = useSort(filtered, sortKey, sortDir, {
    name: (r) => r.name,
    tours: (r) => r.tours,
    earned: (r) => r.earned,
    inProgress: (r) => r.inProgress,
    charges: (r) => r.charges,
    net: (r) => r.net,
  });
  const onSort = (k: string) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir(k === 'name' ? 'asc' : 'desc');
    }
  };
  const totals = filtered.reduce(
    (t, r) => ({
      tours: t.tours + r.tours,
      earned: t.earned + r.earned,
      inProgress: t.inProgress + r.inProgress,
      charges: t.charges + r.charges,
      net: t.net + r.net,
    }),
    { tours: 0, earned: 0, inProgress: 0, charges: 0, net: 0 },
  );

  // Old links (?driver=ID) go straight to the driver's page.
  const legacy = params.get('driver');
  if (legacy) return <Navigate to={`/gross-by-driver/${legacy}`} replace />;

  const exportCsv = () =>
    downloadCSV(
      `gross-by-driver-${range.start}_${range.end}.csv`,
      ['Driver', 'Driver ID', 'Tours done', 'Earned', 'In progress', 'Charges', 'Net'],
      sorted.map((r) => [r.name, r.driver.driverId, r.tours, r.earned, r.inProgress, r.charges, r.net]),
    );

  return (
    <div>
      <PageHeader
        title="Gross by Driver"
        subtitle="Amazon tour price per driver · click a driver for their tours"
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export
          </Button>
        }
      />

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodPicker value={period} onChange={setPeriod} />
          <Input
            placeholder="Search driver…"
            className="w-56"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Card>

      <Card className="overflow-clip">
        <CardHeader>
          <CardTitle>
            {formatDate(range.start, 'MMM d')} – {formatDate(range.end, 'MMM d, yyyy')} · {filtered.length} drivers
          </CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-bg/80">
                <SortHeader label="Driver" sortKey="name" currentKey={sortKey} direction={sortDir} onSort={onSort} />
                <SortHeader label="Tours done" sortKey="tours" currentKey={sortKey} direction={sortDir} onSort={onSort} align="right" />
                <SortHeader label="Earned" sortKey="earned" currentKey={sortKey} direction={sortDir} onSort={onSort} align="right" />
                <SortHeader label="In progress" sortKey="inProgress" currentKey={sortKey} direction={sortDir} onSort={onSort} align="right" />
                <SortHeader label="Charges" sortKey="charges" currentKey={sortKey} direction={sortDir} onSort={onSort} align="right" />
                <SortHeader label="Net" sortKey="net" currentKey={sortKey} direction={sortDir} onSort={onSort} align="right" />
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.driver.id}
                  className="cursor-pointer border-b border-border/60 table-row-hover"
                  onClick={() => navigate(`/gross-by-driver/${r.driver.id}`)}
                >
                  <td className="px-3 py-2.5">
                    <Link
                      to={`/gross-by-driver/${r.driver.id}`}
                      className="font-medium text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.name}
                    </Link>
                    <span className="ml-2 text-xs text-text-secondary">{r.driver.driverId}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.tours}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatCurrency(r.earned)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                    {r.inProgress ? formatCurrency(r.inProgress) : '—'}
                    {r.inProgressTours ? <span className="ml-1 text-xs">({r.inProgressTours})</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-danger">
                    {r.charges ? formatCurrency(r.charges) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(r.net)}</td>
                  <td className="px-2 text-text-secondary"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              ))}
              {unlinkedTours > 0 && !search && (
                <tr className="border-b border-border/60 text-text-secondary">
                  <td className="px-3 py-2.5">
                    Not linked to a driver{' '}
                    <Link to="/gross-board" className="text-xs text-primary hover:underline">see Gross Board</Link>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{unlinkedTours}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(unlinkedEarned)}</td>
                  <td colSpan={4} />
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-primary/5 font-semibold">
                <td className="px-3 py-3">Total</td>
                <td className="px-3 py-3 text-right tabular-nums">{totals.tours + (search ? 0 : unlinkedTours)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-primary">
                  {formatCurrency(totals.earned + (search ? 0 : unlinkedEarned))}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(totals.inProgress)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(totals.charges)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(totals.net)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
