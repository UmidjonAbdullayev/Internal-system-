import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleHelp, Download, Plus } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { SearchInput } from '@/components/ui/SearchInput';
import { Select, Input, Field, Textarea } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { SyncStatusLine } from '@/components/trips/SyncStatusLine';
import { LiveMirrorBanner } from '@/components/trips/LiveMirrorBanner';
import { TripLegend } from '@/components/trips/TripLegend';
import { TripRow } from '@/components/trips/TripRow';
import {
  activeFilterLabels,
  displayStatusLabel,
  filterTrips,
  historySummary,
  tabCountsFromTrips,
  tripDriverName,
  type TripTab,
} from '@/lib/relayTrips';
import {
  liveMirrorMode,
  sectionForTab,
  syncStateForSection,
} from '@/lib/liveMirrors';
import { DateRangeFilter } from '@/components/ui/DateRangeFilter';
import {
  downloadCSV,
  formatCurrency,
  formatNumber,
  getDateRangeFromPreset,
  getDriverFullName,
  isoToZonedYmd,
  todayISO,
} from '@/lib/utils';
import type { DatePreset, DateRange, LoadStatus, PaymentStatus, TrailerType } from '@/types';

const HISTORY_TZ_DEFAULT = 'Asia/Tashkent';
const HISTORY_PRESET_LABELS: Partial<Record<DatePreset, string>> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_45_days: 'Last 45 days',
  custom: 'Custom',
};

const LOAD_STATUSES: LoadStatus[] = [
  'Available',
  'Booked',
  'Dispatched',
  'In Transit',
  'Delivered',
  'Completed',
  'Cancelled',
  'Rejected',
];
const PAYMENT_STATUSES: PaymentStatus[] = [
  'Not Received',
  'Pending',
  'Processing',
  'Paid',
  'On Hold',
  'Disputed',
];
const TRAILER_TYPES: TrailerType[] = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Box Truck'];

const TRIP_TABS: { id: TripTab; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'in_transit', label: 'In Transit' },
  { id: 'history', label: 'History' },
  { id: 'all', label: 'All' },
];

const emptyForm = {
  loadId: '',
  amazonRefId: '',
  driverId: '' as string | null,
  loadStatus: 'Booked' as LoadStatus,
  paymentStatus: 'Not Received' as PaymentStatus,
  pickupLocation: '',
  deliveryLocation: '',
  pickupDate: new Date().toISOString().slice(0, 10),
  deliveryDate: new Date().toISOString().slice(0, 10),
  trailerId: '',
  trailerType: 'Dry Van' as TrailerType,
  tractorId: '',
  distanceMiles: 0,
  rateGross: 0,
  additionalCharges: 0,
  paymentDate: null as string | null,
  notes: '',
};

export function LoadsPage() {
  const {
    loads,
    drivers,
    relayTrips,
    relaySnapshots,
    activityLogs,
    syncState,
    extensionHeartbeat,
    sectionSnapshots,
    companySettings,
    addLoad,
    dataSource,
    refreshData,
    dataReady,
    dataError,
  } = useData();
  const [params, setParams] = useSearchParams();
  // History end-time filter TZ — default Asia/Tashkent (configurable via Settings timezone).
  const historyTz =
    companySettings.timezone === 'Asia/Tashkent' || companySettings.timezone === 'Asia/Samarkand'
      ? companySettings.timezone
      : HISTORY_TZ_DEFAULT;
  const urlTab = params.get('tab') as TripTab | null;
  const [tab, setTab] = useState<TripTab>(
    urlTab && TRIP_TABS.some((x) => x.id === urlTab) ? urlTab : 'in_transit',
  );
  const [tabAutoPicked, setTabAutoPicked] = useState(Boolean(urlTab));
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [statusFilter, setStatusFilter] = useState(params.get('status') ?? '');
  const [driverFilter, setDriverFilter] = useState(params.get('driver') ?? '');
  const [lateOnly, setLateOnly] = useState(params.get('late') === '1');
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(params.get('attention') === '1');
  const [historyPreset, setHistoryPreset] = useState<DatePreset>('this_week');
  const [historyCustom, setHistoryCustom] = useState<DateRange>(() =>
    getDateRangeFromPreset('this_week', undefined, todayISO(historyTz)),
  );
  const [showLastKnown, setShowLastKnown] = useState(false);
  const [showRecentlyCancelled, setShowRecentlyCancelled] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [legendOpen, setLegendOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const listRef = useRef<HTMLDivElement>(null);

  const liveSection = sectionForTab(tab === 'all' ? 'in_transit' : tab);
  const sectionSync = liveSection ? syncStateForSection(syncState, liveSection) : undefined;
  const sectionSnap =
    sectionSnapshots.find((s) => s.section === liveSection) ||
    relaySnapshots.find((s) => s.section === liveSection);
  const mirrorMode =
    tab === 'upcoming' || tab === 'in_transit'
      ? liveMirrorMode(sectionSync, {
          showLastKnown,
          heartbeat: extensionHeartbeat,
        })
      : 'live';

  useEffect(() => {
    if (params.get('action') === 'new') {
      openCreate();
      params.delete('action');
      setParams(params, { replace: true });
    }
    const t = params.get('tab') as TripTab | null;
    if (t && TRIP_TABS.some((x) => x.id === t)) {
      setTab(t);
      setTabAutoPicked(true);
    }
  }, [params, setParams]);

  const snapshots = sectionSnapshots.length ? sectionSnapshots : relaySnapshots;

  const historyRange = useMemo(
    () => getDateRangeFromPreset(historyPreset, historyCustom, todayISO(historyTz)),
    [historyPreset, historyCustom, historyTz],
  );

  const tripEndYmd = useCallback(
    (t: Parameters<typeof filterTrips>[0][number]) =>
      isoToZonedYmd(t.endTime || t.startTime || t.lastSeenAt || t.updatedAt, historyTz),
    [historyTz],
  );

  /** ONE selector for tab counts, list, and empty-state (CRM rows only — never snapshot totals). */
  const selectTrips = useCallback(
    (
      forTab: TripTab,
      filters: {
        search: string;
        status: string;
        driver: string;
        lateOnly: boolean;
        needsAttentionOnly: boolean;
        applyHistoryDates: boolean;
      },
    ) =>
      filterTrips(relayTrips, {
        tab: forTab,
        search: filters.search,
        status: filters.status,
        driver: filters.driver,
        lateOnly: filters.lateOnly,
        needsAttentionOnly: filters.needsAttentionOnly,
        endDateStart: filters.applyHistoryDates && forTab === 'history' ? historyRange.start : null,
        endDateEnd: filters.applyHistoryDates && forTab === 'history' ? historyRange.end : null,
        tripEndYmd,
        showRecentlyCancelled,
      }),
    [relayTrips, historyRange, tripEndYmd, showRecentlyCancelled],
  );

  const tabCounts = useMemo(() => tabCountsFromTrips(relayTrips), [relayTrips]);

  const relayTileHint = useMemo(() => {
    const it = snapshots.find((s) => s.section === 'IN_TRANSIT');
    const up = snapshots.find((s) => s.section === 'UPCOMING');
    if (!it && !up) return null;
    return `Relay total incl. cancelled: Upcoming ${up?.totalRecords ?? '—'} · In Transit ${it?.totalRecords ?? '—'}`;
  }, [snapshots]);

  useEffect(() => {
    if (tabAutoPicked || !relayTrips.length) return;
    const preferred: TripTab[] = ['in_transit', 'upcoming', 'history', 'all'];
    const next =
      preferred.find((t) => (t === 'all' ? relayTrips.length > 0 : tabCounts[t] > 0)) || 'all';
    if (next !== tab) {
      setTab(next);
      const nextParams = new URLSearchParams(params);
      nextParams.set('tab', next);
      setParams(nextParams, { replace: true });
    }
    setTabAutoPicked(true);
  }, [relayTrips.length, tabCounts, tabAutoPicked, tab, params, setParams]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of relayTrips) set.add(displayStatusLabel(t));
    return [...set].sort();
  }, [relayTrips]);

  const driverOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of relayTrips) {
      const n = tripDriverName(t);
      if (n) set.add(n);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [relayTrips]);

  const filtered = useMemo(() => {
    // Always show CRM rows — sync health is a chip, never blanks the list.
    void mirrorMode;
    void showLastKnown;
    const rows = selectTrips(tab, {
      search,
      status: statusFilter,
      driver: driverFilter,
      lateOnly,
      needsAttentionOnly,
      applyHistoryDates: tab === 'history',
    });
    if (tab === 'history') {
      return [...rows].sort((a, b) => {
        const ae = Date.parse(a.endTime || a.startTime || '') || 0;
        const be = Date.parse(b.endTime || b.startTime || '') || 0;
        return be - ae;
      });
    }
    return rows;
  }, [
    selectTrips,
    tab,
    search,
    statusFilter,
    driverFilter,
    lateOnly,
    needsAttentionOnly,
    mirrorMode,
    showLastKnown,
  ]);

  const inTabCount = useMemo(() => {
    if (tab === 'all') return relayTrips.length;
    return selectTrips(tab, {
      search: '',
      status: '',
      driver: '',
      lateOnly: false,
      needsAttentionOnly: false,
      applyHistoryDates: false,
    }).length;
  }, [relayTrips.length, tab, selectTrips]);

  const historyStats = useMemo(
    () => (tab === 'history' ? historySummary(filtered) : null),
    [tab, filtered],
  );

  const namedFilters = useMemo(
    () =>
      activeFilterLabels({
        search,
        status: statusFilter,
        driver: driverFilter,
        lateOnly,
        needsAttentionOnly,
        datePresetActive: tab === 'history',
        datePresetLabel: HISTORY_PRESET_LABELS[historyPreset],
      }),
    [search, statusFilter, driverFilter, lateOnly, needsAttentionOnly, tab, historyPreset],
  );

  const clearFilters = useCallback(() => {
    setSearch('');
    setStatusFilter('');
    setDriverFilter('');
    setLateOnly(false);
    setNeedsAttentionOnly(false);
    setHistoryPreset('this_week');
    setHistoryCustom(getDateRangeFromPreset('this_week', undefined, todayISO(historyTz)));
    const next = new URLSearchParams(params);
    next.delete('q');
    next.delete('status');
    next.delete('driver');
    next.delete('late');
    next.delete('attention');
    setParams(next, { replace: true });
  }, [params, setParams, historyTz]);

  useEffect(() => {
    setFocusedIndex((i) => (filtered.length ? Math.min(i, filtered.length - 1) : 0));
  }, [filtered.length]);

  const selectTab = (id: TripTab) => {
    setTab(id);
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  const openCreate = () => {
    setForm({
      ...emptyForm,
      loadId: `LD-${8500 + loads.length}`,
      amazonRefId: `AMZ-R${String(920200 + loads.length).padStart(7, '0')}`,
    });
    setFormOpen(true);
  };

  const saveForm = () => {
    if (!form.loadId || !form.pickupLocation || !form.deliveryLocation) return;
    addLoad({
      ...form,
      driverId: form.driverId || null,
      paymentDate: form.paymentDate || null,
      tractorId: form.tractorId || '',
    });
    setFormOpen(false);
  };

  const exportCSV = () => {
    downloadCSV(
      'trips-export.csv',
      [
        'Trip ID',
        'Section',
        'Driver',
        'Status',
        'Tractor',
        'Trailer',
        'Miles',
        'Pay',
        'Rate/mi',
        'Legs',
        'Stops',
      ],
      filtered.map((t) => [
        t.tripId,
        t.section || '',
        tripDriverName(t),
        displayStatusLabel(t),
        t.legs.map((l) => l.tractorId).filter(Boolean).join('|'),
        t.legs.map((l) => l.trailerId).filter(Boolean).join('|'),
        t.totalMiles ?? '',
        t.payout ?? '',
        t.ratePerMile ?? '',
        t.legs.length,
        t.legs.reduce((n, l) => n + l.stops.length, 0),
      ]),
    );
  };

  const onListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!filtered.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const trip = filtered[focusedIndex];
        if (trip) {
          setExpandedId((id) => (id === trip.tripId ? null : trip.tripId));
        }
      }
    },
    [filtered, focusedIndex],
  );

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-trip-id="${filtered[focusedIndex]?.tripId}"]`);
    if (el && 'scrollIntoView' in el) {
      (el as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex, filtered]);

  const filtersActive = namedFilters.length > 0;

  return (
    <div>
      <PageHeader
        title="Loads / Trips"
        subtitle={
          <span className="block">
            <SyncStatusLine
              syncState={sectionSync}
              showLastKnown={showLastKnown}
              heartbeat={extensionHeartbeat}
              sectionLabel={liveSection || 'IN_TRANSIT'}
            />
            <span className="mt-0.5 block text-xs text-text-secondary">
              {filtered.length} shown · {dataSource}
              {snapshots.some((s) => s.mismatch) ? ' · snapshot mismatch — check extension popup' : ''}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setLegendOpen(true)}>
              <CircleHelp className="h-4 w-4" /> Legend
            </Button>
            <Button variant="outline" size="sm" onClick={() => void refreshData()}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add Load
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {TRIP_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text'
            }`}
          >
            {t.label}
            <span className="ml-2 text-xs tabular-nums text-text-secondary">{tabCounts[t.id]}</span>
          </button>
        ))}
      </div>

      {dataError && (
        <div
          className="mb-3 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          Failed to load trips from Supabase: {dataError}. Showing last loaded rows (if any).
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => void refreshData()}
          >
            Retry
          </button>
        </div>
      )}

      {(tab === 'upcoming' || tab === 'in_transit') && (
        <LiveMirrorBanner
          mode={mirrorMode}
          relayCount={sectionSnap?.totalRecords}
          sectionLabel={liveSection || 'IN_TRANSIT'}
          lastSuccessfulSyncAt={sectionSync?.lastSuccessfulSyncAt}
          extensionAliveAt={
            extensionHeartbeat?.aliveAt || sectionSync?.lastSuccessfulSyncAt || null
          }
          onShowLastKnown={() => setShowLastKnown(true)}
        />
      )}

      {relayTileHint && (
        <p className="mb-2 text-[11px] text-text-secondary" title={relayTileHint}>
          {relayTileHint}
        </p>
      )}

      {tab === 'history' && historyStats && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-border bg-bg px-3 py-2 text-xs text-text-secondary">
          <span>
            <span className="font-semibold text-text">{historyStats.trips}</span> trips
          </span>
          <span>
            <span className="font-semibold text-text">{historyStats.delivered}</span> delivered
          </span>
          <span>
            <span className="font-semibold text-text">{historyStats.cancelled}</span> cancelled
          </span>
          <span>
            <span className="font-semibold text-text">{formatNumber(historyStats.totalMiles, 0)}</span> mi
          </span>
          <span>
            <span className="font-semibold text-text">{formatCurrency(historyStats.totalPay)}</span> pay
          </span>
          <span>
            avg{' '}
            <span className="font-semibold text-text">{formatCurrency(historyStats.avgPerMi)}</span>/mi
          </span>
          <span>
            late stops{' '}
            <span className="font-semibold text-text">
              {historyStats.lateStops} ({formatNumber(historyStats.latePct, 0)}%)
            </span>
          </span>
          <span className="text-text-secondary">End time · {historyTz}</span>
        </div>
      )}

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search trip, load, driver, tractor, trailer, city, facility…"
            className="w-full sm:w-80"
          />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
            <option value="">All Statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Select value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} className="w-44">
            <option value="">All Drivers</option>
            {driverOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
          <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 h-9 text-xs font-medium text-text cursor-pointer select-none">
            <input
              type="checkbox"
              checked={lateOnly}
              onChange={(e) => setLateOnly(e.target.checked)}
              className="rounded border-border"
            />
            Late only
          </label>
          <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 h-9 text-xs font-medium text-text cursor-pointer select-none">
            <input
              type="checkbox"
              checked={needsAttentionOnly}
              onChange={(e) => setNeedsAttentionOnly(e.target.checked)}
              className="rounded border-border"
            />
            Needs attention
          </label>
          {tab === 'upcoming' && (
            <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 h-9 text-xs font-medium text-text cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showRecentlyCancelled}
                onChange={(e) => setShowRecentlyCancelled(e.target.checked)}
                className="rounded border-border"
              />
              Show recently cancelled
            </label>
          )}
        </div>
        {tab === 'history' && (
          <div className="mt-3">
            <DateRangeFilter
              preset={historyPreset}
              onPresetChange={(p) => {
                setHistoryPreset(p);
                if (p !== 'custom') {
                  setHistoryCustom(getDateRangeFromPreset(p, undefined, todayISO(historyTz)));
                }
              }}
              customRange={historyCustom}
              onCustomRangeChange={setHistoryCustom}
            />
          </div>
        )}
        {inTabCount > 0 && filtered.length === 0 && filtersActive && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <span>
              {inTabCount} trip{inTabCount === 1 ? '' : 's'} in this tab, but filters hide them (
              {namedFilters.join('; ')}).
            </span>
            <Button variant="outline" size="sm" type="button" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        {/* Sticky header — desktop */}
        <div className="sticky top-0 z-10 hidden md:grid grid-cols-[minmax(9rem,1.1fr)_minmax(8rem,1fr)_minmax(12rem,1.4fr)_minmax(11rem,1.3fr)_minmax(7rem,0.9fr)_minmax(6.5rem,0.85fr)_2rem] gap-3 border-b border-border bg-bg/95 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary backdrop-blur">
          <div>Trip</div>
          <div>Driver</div>
          <div>Route</div>
          <div>Progress</div>
          <div>Status</div>
          <div className="text-right">Pay</div>
          <div />
        </div>

        <div
          ref={listRef}
          tabIndex={0}
          onKeyDown={onListKeyDown}
          className="outline-none focus-visible:ring-2 focus-visible:ring-secondary/30 focus-visible:ring-inset"
          aria-label="Trips list"
        >
          {filtered.map((trip, index) => (
            <TripRow
              key={trip.id || trip.tripId}
              trip={trip}
              expanded={expandedId === trip.tripId}
              selected={focusedIndex === index}
              onToggle={() => {
                setFocusedIndex(index);
                setExpandedId((id) => (id === trip.tripId ? null : trip.tripId));
              }}
              drivers={drivers}
              activityLogs={activityLogs}
            />
          ))}
        </div>

        {filtered.length === 0 && dataReady && (
          <EmptyState
            title={
              dataError
                ? 'Could not refresh trips'
                : relayTrips.length === 0
                  ? 'No Relay trips synced yet'
                  : filtersActive && inTabCount > 0
                    ? 'Filters hide synced trips'
                    : tab === 'in_transit'
                      ? 'No In Transit trips in Relay right now'
                      : tab === 'upcoming'
                        ? 'No upcoming trips in Relay right now'
                        : tab === 'history'
                          ? 'No History trips in this date range'
                          : 'No trips in this tab'
            }
            description={
              dataError
                ? `Supabase error: ${dataError}. Previous rows are kept when a refresh fails.`
                : relayTrips.length === 0
                  ? 'Extension writes relay_trips / legs / stops. Open Amazon Relay Trips, GO LIVE, then Refresh.'
                  : filtersActive && inTabCount > 0
                    ? `Active filters: ${namedFilters.join('; ')}.`
                    : tab === 'upcoming' || tab === 'in_transit'
                      ? mirrorMode === 'auth'
                        ? 'Log in to Amazon Relay in the extension tab, then wait for sync.'
                        : 'Switch tabs or wait for the next Relay snapshot.'
                      : 'Try another date preset or clear filters.'
            }
            actionLabel={filtersActive && inTabCount > 0 ? 'Clear filters' : 'Refresh'}
            onAction={
              filtersActive && inTabCount > 0 ? clearFilters : () => void refreshData()
            }
          />
        )}
      </Card>

      <TripLegend open={legendOpen} onClose={() => setLegendOpen(false)} />

      {/* Manual CRM load (settlements / reports path) — does not invent relay_trips rows */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Add New Load"
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveForm}>Create Load</Button>
          </>
        }
      >
        <p className="mb-3 text-xs text-text-secondary">
          Manual loads still save to the CRM <span className="font-mono">loads</span> table for
          settlements/reports. Live Trips list above reads <span className="font-mono">relay_trips</span>.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Load ID">
            <Input value={form.loadId} onChange={(e) => setForm({ ...form, loadId: e.target.value })} />
          </Field>
          <Field label="Amazon Reference ID">
            <Input
              value={form.amazonRefId}
              onChange={(e) => setForm({ ...form, amazonRefId: e.target.value })}
            />
          </Field>
          <Field label="Driver">
            <Select
              value={form.driverId ?? ''}
              onChange={(e) => setForm({ ...form, driverId: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {getDriverFullName(d.firstName, d.lastName)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Load Status">
            <Select
              value={form.loadStatus}
              onChange={(e) => setForm({ ...form, loadStatus: e.target.value as LoadStatus })}
            >
              {LOAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Payment Status">
            <Select
              value={form.paymentStatus}
              onChange={(e) => setForm({ ...form, paymentStatus: e.target.value as PaymentStatus })}
            >
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Payment Date">
            <Input
              type="date"
              value={form.paymentDate ?? ''}
              onChange={(e) => setForm({ ...form, paymentDate: e.target.value || null })}
            />
          </Field>
          <Field label="Pickup Location">
            <Input
              value={form.pickupLocation}
              onChange={(e) => setForm({ ...form, pickupLocation: e.target.value })}
            />
          </Field>
          <Field label="Delivery Location">
            <Input
              value={form.deliveryLocation}
              onChange={(e) => setForm({ ...form, deliveryLocation: e.target.value })}
            />
          </Field>
          <Field label="Trailer ID">
            <Input value={form.trailerId} onChange={(e) => setForm({ ...form, trailerId: e.target.value })} />
          </Field>
          <Field label="Tractor ID">
            <Input value={form.tractorId} onChange={(e) => setForm({ ...form, tractorId: e.target.value })} />
          </Field>
          <Field label="Pickup Date">
            <Input
              type="date"
              value={form.pickupDate}
              onChange={(e) => setForm({ ...form, pickupDate: e.target.value })}
            />
          </Field>
          <Field label="Delivery Date">
            <Input
              type="date"
              value={form.deliveryDate}
              onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })}
            />
          </Field>
          <Field label="Trailer Type">
            <Select
              value={form.trailerType}
              onChange={(e) => setForm({ ...form, trailerType: e.target.value as TrailerType })}
            >
              {TRAILER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Distance (Miles)">
            <Input
              type="number"
              value={form.distanceMiles}
              onChange={(e) => setForm({ ...form, distanceMiles: Number(e.target.value) })}
            />
          </Field>
          <Field label="Rate / Gross ($)">
            <Input
              type="number"
              step="0.01"
              value={form.rateGross}
              onChange={(e) => setForm({ ...form, rateGross: Number(e.target.value) })}
            />
          </Field>
          <Field label="Additional Charges ($)">
            <Input
              type="number"
              step="0.01"
              value={form.additionalCharges}
              onChange={(e) => setForm({ ...form, additionalCharges: Number(e.target.value) })}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2 lg:col-span-3">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <p className="mt-3 text-sm text-text-secondary">
          Final Gross:{' '}
          <span className="font-semibold text-text">
            {formatCurrency(form.rateGross + form.additionalCharges)}
          </span>
        </p>
      </Modal>

    </div>
  );
}
