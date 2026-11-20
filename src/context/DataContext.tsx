import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type {
  Driver,
  Load,
  LoadReport,
  DriverFee,
  OneTimeCharge,
  Settlement,
  ActivityLog,
  GrossAdjustment,
  SettlementPayment,
  SettlementAdjustment,
  AppUser,
  RelayPayment,
  RelayTrip,
  RelaySectionSnapshot,
  RelaySyncHealth,
  SyncStateRow,
  TripSummary,
  ExtensionHeartbeat,
} from '@/types';
import { computeOrRefreshSettlement, remainingBalance } from '@/lib/calculations';
import { generateId, getWeekRange } from '@/lib/utils';
import {
  excludeFixtureInvoices,
  mapInvoice,
  mapInvoiceTrip,
  mapPaymentsSummary,
  type InvoiceRow,
  type InvoiceTripRow,
  type PaymentsSummaryRow,
} from '@/lib/invoiceMoney';
import { supabase } from '@/lib/supabase';
import {
  loadReportToRow,
  mapActivity,
  mapCharge,
  mapDriver,
  mapFee,
  mapLoad,
  mapRelayPayment,
  mapRelaySectionSnapshot,
  mapSettlement,
  mapExtensionHeartbeat,
  mapSyncState,
  mapTripSummary,
  mapRelayStop,
} from '@/lib/supabaseMappers';
import { computeSyncHealth } from '@/lib/relayTrips';
import { DEFAULT_HISTORY_RETENTION_DAYS } from '@/lib/liveMirrors';
import {
  mapLoadOverride,
  mapReportLoad,
  type LoadOverrideRow,
  type ReportLoadRow,
} from '@/lib/reportLoadMoney';
import {
  fetchLoadsLean,
  fetchRelayTripsScoped,
  fetchReportLoads,
  fetchStopsForTripIds,
  countRelayTripsBySection,
} from '@/lib/crmFetch';
import type { RelayLeg, RelayStop } from '@/types';
import { toast } from 'sonner';

interface CompanySettings {
  companyName: string;
  companyAddress: string;
  ein: string;
  weekStartsOn: 0 | 1;
  defaultDispatchFeePercent: number;
  currency: string;
  timezone: string;
  historyRetentionDays: number;
}

/** Clean-start defaults — no sample drivers/loads (sampleData kept for scripts only). */
const EMPTY_USER: AppUser = {
  id: 'user-1',
  name: 'Admin',
  email: 'admin@internal.local',
  role: 'Owner',
  companyName: 'Internal Sys',
};

const EMPTY_SETTINGS: CompanySettings = {
  companyName: 'Internal Sys',
  companyAddress: '',
  ein: '',
  weekStartsOn: 0, // Amazon money weeks are Sunday–Saturday (LA)
  defaultDispatchFeePercent: 10,
  currency: 'USD',
  timezone: 'America/Los_Angeles',
  historyRetentionDays: DEFAULT_HISTORY_RETENTION_DAYS,
};

interface DataContextValue {
  drivers: Driver[];
  loads: Load[];
  relayTrips: RelayTrip[];
  relaySnapshots: RelaySectionSnapshot[];
  relaySyncHealth: RelaySyncHealth;
  loadReports: LoadReport[];
  /** Canonical money rows — one per Relay tour (view report_loads). */
  reportLoads: ReportLoadRow[];
  loadOverrides: LoadOverrideRow[];
  payments: RelayPayment[];
  invoices: InvoiceRow[];
  invoiceTrips: InvoiceTripRow[];
  paymentsSummary: PaymentsSummaryRow | null;
  driverFees: DriverFee[];
  oneTimeCharges: OneTimeCharge[];
  settlements: Settlement[];
  activityLogs: ActivityLog[];
  grossAdjustments: GrossAdjustment[];
  syncState: SyncStateRow[];
  extensionHeartbeat: ExtensionHeartbeat | null;
  sectionSnapshots: RelaySectionSnapshot[];
  tripSummaries: TripSummary[];
  currentUser: AppUser;
  companySettings: CompanySettings;
  dataSource: 'supabase' | 'local';
  dataReady: boolean;
  dataError: string | null;
  /** True while a background hydrate chunk is in flight (progress bar). */
  dataFetching: boolean;
  /** Server-side section counts (head:exact) — avoids scanning all trips for tabs. */
  tripSectionCounts: { in_transit: number; upcoming: number; history: number; all: number };
  refreshData: () => Promise<void>;
  /** Ensure History trips (paged) are loaded for the date window. */
  ensureHistoryTrips: (opts?: { endFrom?: string; endTo?: string }) => Promise<void>;
  /** Lazy-load stops for trip ids (expand / history backfill). */
  ensureTripStops: (tripIds: string[]) => Promise<void>;
  // Drivers
  addDriver: (driver: Omit<Driver, 'id' | 'createdAt' | 'updatedAt'>) => Driver;
  updateDriver: (id: string, patch: Partial<Driver>) => void;
  deactivateDriver: (id: string) => void;
  getDriver: (id: string) => Driver | undefined;
  // Loads
  addLoad: (load: Omit<Load, 'id' | 'createdAt' | 'updatedAt' | 'statusHistory'>) => Load;
  updateLoad: (id: string, patch: Partial<Load>) => void;
  deleteLoad: (id: string) => void;
  getLoad: (id: string) => Load | undefined;
  // Load reports (ops spreadsheet)
  addLoadReport: (
    report: Omit<LoadReport, 'id' | 'createdAt' | 'updatedAt'>,
  ) => LoadReport;
  updateLoadReport: (id: string, patch: Partial<LoadReport>) => void;
  deleteLoadReport: (id: string) => void;
  syncLoadReportsForRange: (
    start: string,
    end: string,
    opts?: { quiet?: boolean },
  ) => Promise<number>;
  /** Upsert manual fields for a tour (Reports edits). Rehydrates report_loads. */
  upsertLoadOverride: (
    tourId: string,
    patch: Partial<
      Pick<LoadOverrideRow, 'driverName' | 'driverPaid' | 'comment' | 'dispatch' | 'mile' | 'broker'>
    >,
  ) => Promise<void>;
  // Fees
  addFee: (fee: Omit<DriverFee, 'id' | 'createdAt' | 'updatedAt'>) => DriverFee;
  updateFee: (id: string, patch: Partial<DriverFee>) => void;
  deleteFee: (id: string) => void;
  // One-time charges
  addOneTimeCharge: (charge: Omit<OneTimeCharge, 'id' | 'createdAt'>) => OneTimeCharge;
  updateOneTimeCharge: (id: string, patch: Partial<OneTimeCharge>) => void;
  deleteOneTimeCharge: (id: string) => void;
  // Settlements
  getSettlement: (id: string) => Settlement | undefined;
  getOrCreateSettlement: (driverId: string, weekStart: string) => Settlement;
  recalculateSettlement: (id: string) => void;
  updateSettlementStatus: (id: string, status: Settlement['status']) => void;
  finalizeSettlement: (id: string) => void;
  markSettlementPaid: (
    id: string,
    payment: Omit<SettlementPayment, 'id'>
  ) => void;
  addSettlementAdjustment: (
    id: string,
    adjustment: Omit<SettlementAdjustment, 'id'>
  ) => void;
  // Gross adjustments
  addGrossAdjustment: (adj: Omit<GrossAdjustment, 'id' | 'createdAt'>) => void;
  // Settings
  updateSettings: (patch: Partial<CompanySettings>) => void;
  // Activity
  logActivity: (entry: Omit<ActivityLog, 'id' | 'timestamp' | 'user'>) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

function now() {
  return new Date().toISOString();
}

const LIVE_REFRESH_MS = 30_000;
const MONEY_REFRESH_MS = 5 * 60_000;

export function DataProvider({ children }: { children: ReactNode }) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loads, setLoads] = useState<Load[]>([]);
  const [relayTrips, setRelayTrips] = useState<RelayTrip[]>([]);
  const [relaySnapshots, setRelaySnapshots] = useState<RelaySectionSnapshot[]>([]);
  const [relaySyncHealth, setRelaySyncHealth] = useState<RelaySyncHealth>({
    status: 'unknown',
    lastSyncedAt: null,
    detail: null,
  });
  const [loadReports, setLoadReports] = useState<LoadReport[]>([]);
  const [reportLoads, setReportLoads] = useState<ReportLoadRow[]>([]);
  const [loadOverrides, setLoadOverrides] = useState<LoadOverrideRow[]>([]);
  const [payments, setPayments] = useState<RelayPayment[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [invoiceTrips, setInvoiceTrips] = useState<InvoiceTripRow[]>([]);
  const [paymentsSummary, setPaymentsSummary] = useState<PaymentsSummaryRow | null>(null);
  const [driverFees, setDriverFees] = useState<DriverFee[]>([]);
  const [oneTimeCharges, setOneTimeCharges] = useState<OneTimeCharge[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [grossAdjustments, setGrossAdjustments] = useState<GrossAdjustment[]>([]);
  const [syncState, setSyncState] = useState<SyncStateRow[]>([]);
  const [extensionHeartbeat, setExtensionHeartbeat] = useState<ExtensionHeartbeat | null>(null);
  const [sectionSnapshots, setSectionSnapshots] = useState<RelaySectionSnapshot[]>([]);
  const [tripSummaries, setTripSummaries] = useState<TripSummary[]>([]);
  const [currentUser] = useState<AppUser>(EMPTY_USER);
  const [companySettings, setCompanySettings] = useState<CompanySettings>(EMPTY_SETTINGS);
  const [dataReady, setDataReady] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataFetching, setDataFetching] = useState(false);
  const [tripSectionCounts, setTripSectionCounts] = useState({
    in_transit: 0,
    upcoming: 0,
    history: 0,
    all: 0,
  });
  const historyLoadedRef = useRef({ from: '', to: '', loaded: false });
  const lastMoneyAtRef = useRef(0);

  const mergeTripsById = useCallback((prev: RelayTrip[], next: RelayTrip[]) => {
    const map = new Map<string, RelayTrip>();
    for (const t of prev) map.set(t.tripId, t);
    for (const t of next) {
      const existing = map.get(t.tripId);
      // Prefer next legs; keep existing stops if next arrived without stops.
      if (existing && t.legs.every((l) => l.stops.length === 0) && existing.legs.some((l) => l.stops.length > 0)) {
        map.set(t.tripId, {
          ...t,
          legs: t.legs.map((leg) => {
            const old = existing.legs.find((x) => x.loadId === leg.loadId);
            return old && leg.stops.length === 0 ? { ...leg, stops: old.stops } : leg;
          }),
        });
      } else {
        map.set(t.tripId, t);
      }
    }
    return [...map.values()];
  }, []);

  const applyTripCounts = useCallback(async () => {
    try {
      const c = await countRelayTripsBySection();
      const all = c.IN_TRANSIT + c.UPCOMING + c.HISTORY;
      setTripSectionCounts({
        in_transit: c.IN_TRANSIT,
        upcoming: c.UPCOMING,
        history: c.HISTORY,
        all,
      });
    } catch {
      /* ignore count failures */
    }
  }, []);

  /**
   * Progressive hydrate:
   * Wave A — shell + live trips (IT/UP) → dataReady (Loads usable ~1s)
   * Wave B — money + invoices + lean loads in background (Reports/Gross)
   * History — on demand via ensureHistoryTrips (paged 100)
   */
  const hydrate = useCallback(async (opts?: { soft?: boolean; money?: boolean }) => {
    const soft = Boolean(opts?.soft);
    // Money tables (~2 MB) only on full loads or when asked — not on every 30 s refresh.
    const withMoney = !soft || Boolean(opts?.money);
    setDataFetching(true);
    try {
      const [
        driversRes,
        heartbeatRes,
        relaySnapshotsRes,
        syncRunsRes,
        syncStateRes,
        retentionRes,
        activityRes,
        liveTripsRes,
      ] = await Promise.all([
        supabase.from('drivers').select('*').order('created_at', { ascending: true }),
        supabase.from('extension_heartbeat').select('*').eq('id', 1).maybeSingle(),
        supabase.from('relay_section_snapshots').select('*'),
        supabase
          .from('relay_sync_runs')
          .select('finished_at, status, error_count')
          .order('started_at', { ascending: false })
          .limit(5),
        supabase.from('sync_state').select('*'),
        supabase.from('retention_settings').select('*').eq('id', 1).maybeSingle(),
        supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(100),
        fetchRelayTripsScoped({
          sections: ['IN_TRANSIT', 'UPCOMING'],
          includeStops: true,
          limit: 500,
        }),
      ]);

      if (driversRes.error) {
        console.error('Supabase CRM hydrate failed', driversRes.error.message);
        setDataError(driversRes.error.message);
        setDataReady(true);
        return;
      }

      if (liveTripsRes.error) {
        console.error('Live trips hydrate failed', liveTripsRes.error);
        setDataError(liveTripsRes.error);
      } else {
        setDataError(null);
        setRelayTrips((prev) =>
          soft
            ? mergeTripsById(prev, liveTripsRes.trips)
            : mergeTripsById(
                prev.filter((t) => t.section === 'HISTORY'),
                liveTripsRes.trips,
              ),
        );
      }

      setDrivers((driversRes.data || []).map((r) => mapDriver(r as Record<string, unknown>)));

      const snapshots = (relaySnapshotsRes.data || [])
        .map((r) => mapRelaySectionSnapshot(r as Record<string, unknown>))
        .filter((s): s is RelaySectionSnapshot => Boolean(s));
      const lastRunFinished =
        (syncRunsRes.data || [])
          .map((r) => (r as { finished_at?: string | null }).finished_at)
          .find((v) => Boolean(v)) || null;
      setRelaySnapshots(snapshots);
      setSectionSnapshots(snapshots);
      setRelaySyncHealth(computeSyncHealth(snapshots, liveTripsRes.trips, lastRunFinished));

      if (!syncStateRes.error) {
        setSyncState((syncStateRes.data || []).map((r) => mapSyncState(r as Record<string, unknown>)));
      }
      if (!heartbeatRes.error) {
        setExtensionHeartbeat(
          heartbeatRes.data
            ? mapExtensionHeartbeat(heartbeatRes.data as Record<string, unknown>)
            : null,
        );
      }
      if (!retentionRes.error && retentionRes.data) {
        const days = Number(
          (retentionRes.data as { history_retention_days?: number }).history_retention_days,
        );
        if (Number.isFinite(days) && days >= 1) {
          setCompanySettings((prev) => ({ ...prev, historyRetentionDays: days }));
        }
      }
      if (!activityRes.error) {
        setActivityLogs((activityRes.data || []).map((r) => mapActivity(r as Record<string, unknown>)));
      }

      // Wave A complete — layout + Loads/Trips usable.
      setDataReady(true);
      void applyTripCounts();

      // Wave B — money + payments + lean loads (does not block first paint).
      if (withMoney) lastMoneyAtRef.current = Date.now();
      if (withMoney) void (async () => {
        const [
          reportLoadsRes,
          loadOverridesRes,
          invoicesRes,
          invoiceTripsRes,
          paymentsSummaryRes,
          paymentsRes,
          feesRes,
          chargesRes,
          settlementsRes,
          settlementLoadsRes,
          settlementChargesRes,
          summariesRes,
          loadsRes,
        ] = await Promise.all([
          fetchReportLoads(),
          supabase.from('load_overrides').select('*'),
          supabase
            .from('invoices')
            .select('*')
            .not('invoice_id', 'like', 'FIXTURE-%')
            .order('week_start', { ascending: false }),
          supabase.from('invoice_trips').select('*').not('invoice_id', 'like', 'FIXTURE-%'),
          supabase.from('payments_summary').select('*').eq('id', 1).maybeSingle(),
          supabase.from('payments').select('*').order('payment_date', { ascending: false }),
          supabase.from('driver_fees').select('*'),
          supabase.from('one_time_charges').select('*'),
          supabase.from('settlements').select('*'),
          supabase.from('settlement_loads').select('*'),
          supabase.from('settlement_charges').select('*'),
          supabase
            .from('trip_summaries')
            .select('*')
            .order('end_time', { ascending: false })
            .limit(500),
          fetchLoadsLean(),
        ]);

        if (!reportLoadsRes.error) {
          setReportLoads(reportLoadsRes.data.map((r) => mapReportLoad(r)));
        } else {
          console.error('report_loads hydrate failed', reportLoadsRes.error);
        }
        if (!loadOverridesRes.error) {
          setLoadOverrides(
            (loadOverridesRes.data || []).map((r) => mapLoadOverride(r as Record<string, unknown>)),
          );
        }

        const loadIdsBySettlement = new Map<string, string[]>();
        for (const row of settlementLoadsRes.data || []) {
          const sid = String((row as { settlement_id: string }).settlement_id);
          const lid = String((row as { load_id: string }).load_id);
          const list = loadIdsBySettlement.get(sid) || [];
          list.push(lid);
          loadIdsBySettlement.set(sid, list);
        }

        const chargesBySettlement = new Map<string, Settlement['charges']>();
        for (const row of settlementChargesRes.data || []) {
          const r = row as Record<string, unknown>;
          const sid = String(r.settlement_id);
          const list = chargesBySettlement.get(sid) || [];
          list.push({
            id: String(r.id),
            chargeName: String(r.charge_name ?? ''),
            category: r.category as Settlement['charges'][number]['category'],
            calculationType: r.calculation_type as Settlement['charges'][number]['calculationType'],
            originalAmountOrRate: Number(r.original_amount_or_rate) || 0,
            appliedAmount: Number(r.applied_amount) || 0,
            frequency: r.frequency as Settlement['charges'][number]['frequency'],
            chargeType: r.charge_type as Settlement['charges'][number]['chargeType'],
            sourceId: String(r.source_id ?? ''),
          });
          chargesBySettlement.set(sid, list);
        }

        const paymentsBySettlement = new Map<string, Settlement['payments']>();
        const mappedPayments = (paymentsRes.data || []).map((r) =>
          mapRelayPayment(r as Record<string, unknown>),
        );
        for (const p of mappedPayments) {
          if (!p.settlementId) continue;
          const list = paymentsBySettlement.get(p.settlementId) || [];
          list.push({
            id: p.id,
            date: p.paymentDate,
            method: p.method,
            referenceId: p.referenceId,
            amount: p.amount,
            notes: p.notes,
          });
          paymentsBySettlement.set(p.settlementId, list);
        }

        if (!paymentsRes.error) setPayments(mappedPayments);
        if (!invoicesRes.error) {
          setInvoices(
            excludeFixtureInvoices(
              (invoicesRes.data || []).map((r) => mapInvoice(r as Record<string, unknown>)),
            ),
          );
        }
        if (!invoiceTripsRes.error) {
          setInvoiceTrips(
            excludeFixtureInvoices(
              (invoiceTripsRes.data || []).map((r) => mapInvoiceTrip(r as Record<string, unknown>)),
            ),
          );
        }
        if (!paymentsSummaryRes.error) {
          setPaymentsSummary(
            paymentsSummaryRes.data
              ? mapPaymentsSummary(paymentsSummaryRes.data as Record<string, unknown>)
              : null,
          );
        }
        if (!feesRes.error) {
          setDriverFees((feesRes.data || []).map((r) => mapFee(r as Record<string, unknown>)));
        }
        if (!chargesRes.error) {
          setOneTimeCharges((chargesRes.data || []).map((r) => mapCharge(r as Record<string, unknown>)));
        }
        if (!settlementsRes.error) {
          setSettlements(
            (settlementsRes.data || []).map((r) => {
              const row = r as Record<string, unknown>;
              const id = String(row.id);
              return mapSettlement(
                row,
                loadIdsBySettlement.get(id) || [],
                chargesBySettlement.get(id) || [],
                paymentsBySettlement.get(id) || [],
              );
            }),
          );
        }
        if (!summariesRes.error) {
          setTripSummaries(
            (summariesRes.data || []).map((r) => mapTripSummary(r as Record<string, unknown>)),
          );
        }
        if (!loadsRes.error) {
          setLoads(loadsRes.data.map((r) => mapLoad(r)));
        } else {
          console.error('loads lean hydrate failed', loadsRes.error);
        }
      })();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Hydrate failed';
      console.error('CRM hydrate threw', message);
      setDataError(message);
      setDataReady(true);
    } finally {
      setDataFetching(false);
    }
  }, [applyTripCounts, mergeTripsById]);

  const ensureHistoryTrips = useCallback(
    async (opts?: { endFrom?: string; endTo?: string }) => {
      const endFrom = opts?.endFrom ?? '';
      const endTo = opts?.endTo ?? '';
      if (
        historyLoadedRef.current.loaded &&
        historyLoadedRef.current.from === endFrom &&
        historyLoadedRef.current.to === endTo
      ) {
        return;
      }
      setDataFetching(true);
      try {
        // First page fast (100), then backfill remaining HISTORY without blocking UI.
        const page = await fetchRelayTripsScoped({
          sections: ['HISTORY'],
          endFrom: endFrom || null,
          endTo: endTo || null,
          limit: 100,
          offset: 0,
          includeStops: true,
        });
        if (page.error) {
          setDataError(page.error);
          return;
        }
        setRelayTrips((prev) => mergeTripsById(prev, page.trips));
        historyLoadedRef.current = { loaded: true, from: endFrom, to: endTo };

        // Remaining history pages (stops included per chunk of 100).
        let offset = 100;
        for (;;) {
          const more = await fetchRelayTripsScoped({
            sections: ['HISTORY'],
            endFrom: endFrom || null,
            endTo: endTo || null,
            limit: 100,
            offset,
            includeStops: true,
          });
          if (more.error || more.trips.length === 0) break;
          setRelayTrips((prev) => mergeTripsById(prev, more.trips));
          if (more.trips.length < 100) break;
          offset += 100;
        }
        void applyTripCounts();
      } finally {
        setDataFetching(false);
      }
    },
    [applyTripCounts, historyLoadedRef, mergeTripsById],
  );

  const ensureTripStops = useCallback(async (tripIds: string[]) => {
    const missing = tripIds.filter(Boolean);
    if (!missing.length) return;
    const { data, error } = await fetchStopsForTripIds(missing);
    if (error || !data.length) return;

    const stopsByLoad = new Map<string, RelayStop[]>();
    for (const row of data) {
      const stop = mapRelayStop(row);
      if (stop.archived) continue;
      const list = stopsByLoad.get(stop.loadId) || [];
      list.push(stop);
      stopsByLoad.set(stop.loadId, list);
    }

    setRelayTrips((prev) =>
      prev.map((trip) => {
        if (!missing.includes(trip.tripId)) return trip;
        const legs: RelayLeg[] = trip.legs.map((leg) => {
          const stops = stopsByLoad.get(leg.loadId);
          return stops ? { ...leg, stops } : leg;
        });
        return { ...trip, legs };
      }),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void hydrate().then(() => {
      if (cancelled) return;
    });
    // Soft refresh: live trips every 30 s, money every 5 min; nothing while the tab is
    // hidden (each open tab used to re-download ~3 MB every 30 s = most of the egress quota).
    const tick = () => {
      if (cancelled || document.hidden) return;
      const money = Date.now() - lastMoneyAtRef.current >= MONEY_REFRESH_MS;
      void hydrate({ soft: true, money });
    };
    const timer = window.setInterval(tick, LIVE_REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hydrate]);

  const logActivity = useCallback(
    (entry: Omit<ActivityLog, 'id' | 'timestamp' | 'user'>) => {
      setActivityLogs((prev) => [
        {
          ...entry,
          id: generateId('act'),
          timestamp: now(),
          user: currentUser.name,
        },
        ...prev,
      ]);
    },
    [currentUser.name]
  );

  const getDriver = useCallback(
    (id: string) => drivers.find((d) => d.id === id),
    [drivers]
  );

  const addDriver = useCallback(
    (data: Omit<Driver, 'id' | 'createdAt' | 'updatedAt'>) => {
      const id = crypto.randomUUID();
      const ts = now();
      const driver: Driver = {
        ...data,
        id,
        createdAt: ts,
        updatedAt: ts,
      };
      setDrivers((prev) => [...prev, driver]);
      void supabase
        .from('drivers')
        .insert({
          id,
          driver_id: data.driverId,
          first_name: data.firstName,
          last_name: data.lastName,
          phone: data.phone,
          email: data.email,
          status: data.status,
          assigned_truck: data.assignedTruck,
          trailer_id: data.trailerId,
          hire_date: data.hireDate || null,
          notes: data.notes,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip,
          license_number: data.licenseNumber,
          license_expiry: data.licenseExpiry || null,
          created_at: ts,
          updated_at: ts,
        })
        .then(({ error }) => {
          if (error) toast.error(`Driver sync failed: ${error.message}`);
          else void hydrate();
        });
      logActivity({
        type: 'driver',
        action: 'created',
        description: `Driver ${data.firstName} ${data.lastName} added`,
        entityId: driver.id,
      });
      toast.success('Driver added successfully');
      return driver;
    },
    [logActivity, hydrate]
  );

  const updateDriver = useCallback(
    (id: string, patch: Partial<Driver>) => {
      const ts = now();
      setDrivers((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: ts } : d))
      );
      const row: Record<string, unknown> = { updated_at: ts };
      if (patch.driverId != null) row.driver_id = patch.driverId;
      if (patch.firstName != null) row.first_name = patch.firstName;
      if (patch.lastName != null) row.last_name = patch.lastName;
      if (patch.phone != null) row.phone = patch.phone;
      if (patch.email != null) row.email = patch.email;
      if (patch.status != null) row.status = patch.status;
      if (patch.assignedTruck != null) row.assigned_truck = patch.assignedTruck;
      if (patch.trailerId != null) row.trailer_id = patch.trailerId;
      if (patch.hireDate != null) row.hire_date = patch.hireDate;
      if (patch.notes != null) row.notes = patch.notes;
      if (patch.address != null) row.address = patch.address;
      if (patch.city != null) row.city = patch.city;
      if (patch.state != null) row.state = patch.state;
      if (patch.zip != null) row.zip = patch.zip;
      if (patch.licenseNumber != null) row.license_number = patch.licenseNumber;
      if (patch.licenseExpiry != null) row.license_expiry = patch.licenseExpiry;
      void supabase
        .from('drivers')
        .update(row)
        .eq('id', id)
        .then(({ error }) => {
          if (error) toast.error(`Driver update failed: ${error.message}`);
        });
      logActivity({
        type: 'driver',
        action: 'updated',
        description: `Driver profile updated`,
        entityId: id,
      });
      toast.success('Driver updated');
    },
    [logActivity]
  );

  const deactivateDriver = useCallback(
    (id: string) => {
      setDrivers((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, status: 'Inactive', updatedAt: now() } : d
        )
      );
      void supabase
        .from('drivers')
        .update({ status: 'Inactive', updated_at: now() })
        .eq('id', id);
      logActivity({
        type: 'driver',
        action: 'deactivated',
        description: 'Driver deactivated',
        entityId: id,
      });
      toast.success('Driver deactivated');
    },
    [logActivity]
  );

  const getLoad = useCallback(
    (id: string) => loads.find((l) => l.id === id),
    [loads]
  );

  const addLoad = useCallback(
    (data: Omit<Load, 'id' | 'createdAt' | 'updatedAt' | 'statusHistory'>) => {
      const load: Load = {
        ...data,
        id: generateId('load'),
        statusHistory: [
          { status: data.loadStatus, timestamp: now(), note: 'Load created' },
        ],
        createdAt: now(),
        updatedAt: now(),
      };
      setLoads((prev) => [load, ...prev]);
      logActivity({
        type: 'load',
        action: 'created',
        description: `Load ${load.loadId} created`,
        entityId: load.id,
      });
      toast.success('Load added successfully');
      return load;
    },
    [logActivity]
  );

  const updateLoad = useCallback(
    (id: string, patch: Partial<Load>) => {
      setLoads((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          const updated = { ...l, ...patch, updatedAt: now() };
          if (patch.loadStatus && patch.loadStatus !== l.loadStatus) {
            updated.statusHistory = [
              ...l.statusHistory,
              { status: patch.loadStatus, timestamp: now() },
            ];
          }
          return updated;
        })
      );
      logActivity({
        type: 'load',
        action: 'updated',
        description: `Load updated`,
        entityId: id,
      });
      toast.success('Load updated');
    },
    [logActivity]
  );

  const deleteLoad = useCallback(
    (id: string) => {
      const load = loads.find((l) => l.id === id);
      setLoads((prev) => prev.filter((l) => l.id !== id));
      logActivity({
        type: 'load',
        action: 'deleted',
        description: `Load ${load?.loadId ?? id} deleted`,
        entityId: id,
      });
      toast.success('Load deleted');
    },
    [loads, logActivity]
  );

  const addLoadReport = useCallback(
    (data: Omit<LoadReport, 'id' | 'createdAt' | 'updatedAt'>) => {
      const id = crypto.randomUUID();
      const ts = now();
      const report: LoadReport = {
        ...data,
        id,
        createdAt: ts,
        updatedAt: ts,
      };
      setLoadReports((prev) => [...prev, report]);
      void supabase
        .from('load_reports')
        .insert(loadReportToRow(report))
        .then(({ error }) => {
          if (error) toast.error(`Report save failed: ${error.message}`);
          else void hydrate();
        });
      logActivity({
        type: 'load',
        action: 'report_added',
        description: `Report row ${report.loadIds || report.trip || id} added`,
        entityId: id,
      });
      toast.success('Report row added');
      return report;
    },
    [hydrate, logActivity],
  );

  const updateLoadReport = useCallback(
    (id: string, patch: Partial<LoadReport>) => {
      const ts = now();
      setLoadReports((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: ts } : r)),
      );
      const row = loadReportToRow({ ...patch, updatedAt: ts });
      void supabase
        .from('load_reports')
        .update(row)
        .eq('id', id)
        .then(({ error }) => {
          if (error) toast.error(`Report update failed: ${error.message}`);
        });
      logActivity({
        type: 'load',
        action: 'report_updated',
        description: 'Report row updated',
        entityId: id,
      });
      toast.success('Report updated');
    },
    [logActivity],
  );

  const deleteLoadReport = useCallback(
    (id: string) => {
      const row = loadReports.find((r) => r.id === id);
      setLoadReports((prev) => prev.filter((r) => r.id !== id));
      void supabase
        .from('load_reports')
        .delete()
        .eq('id', id)
        .then(({ error }) => {
          if (error) toast.error(`Report delete failed: ${error.message}`);
        });
      logActivity({
        type: 'load',
        action: 'report_deleted',
        description: `Report row ${row?.loadIds ?? id} deleted`,
        entityId: id,
      });
      toast.success('Report row deleted');
    },
    [loadReports, logActivity],
  );

  /**
   * LEGACY: load_reports range sync is disabled (table kept).
   * Reports money UI reads report_loads + load_overrides only.
   * Calling this is a no-op so page-open / accidental callers cannot hit
   * load_reports_load_uuid_idx duplicate-key failures.
   */
  const syncLoadReportsForRange = useCallback(
    async (_start: string, _end: string, opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) {
        toast.message('Legacy load_reports sync disabled — Reports uses report_loads');
      }
      return 0;
    },
    [],
  );

  const upsertLoadOverride = useCallback(
    async (
      tourId: string,
      patch: Partial<
        Pick<LoadOverrideRow, 'driverName' | 'driverPaid' | 'comment' | 'dispatch' | 'mile' | 'broker'>
      >,
    ) => {
      const bare = tourId.trim().toUpperCase().replace(/^T-/, '');
      if (!bare) {
        toast.error('Missing tour id');
        return;
      }
      const ts = now();
      const prevOverride = loadOverrides.find((o) => o.tourId === bare);
      const prevReport = reportLoads.find((r) => r.tourId === bare);

      // Optimistic UI — same fields Reports edits; money amazon_paid untouched.
      setLoadOverrides((prev) => {
        const next: LoadOverrideRow = {
          tourId: bare,
          driverName: patch.driverName !== undefined ? patch.driverName : (prevOverride?.driverName ?? null),
          driverPaid: patch.driverPaid !== undefined ? patch.driverPaid : (prevOverride?.driverPaid ?? null),
          comment: patch.comment !== undefined ? patch.comment : (prevOverride?.comment ?? null),
          dispatch: patch.dispatch !== undefined ? patch.dispatch : (prevOverride?.dispatch ?? null),
          mile: patch.mile !== undefined ? patch.mile : (prevOverride?.mile ?? null),
          broker: patch.broker ?? prevOverride?.broker ?? 'Amazon',
          source: 'manual',
          legacyReportIds: prevOverride?.legacyReportIds ?? [],
          createdAt: prevOverride?.createdAt ?? ts,
          updatedAt: ts,
        };
        const idx = prev.findIndex((o) => o.tourId === bare);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = next;
          return copy;
        }
        return [...prev, next];
      });
      if (prevReport) {
        setReportLoads((prev) =>
          prev.map((r) =>
            r.tourId === bare
              ? {
                  ...r,
                  driverName: patch.driverName ?? r.driverName,
                  driverPaid: patch.driverPaid ?? r.driverPaid,
                  comment: patch.comment ?? r.comment,
                  dispatch: patch.dispatch ?? r.dispatch,
                  mile: patch.mile ?? r.mile,
                  broker: patch.broker ?? r.broker,
                  hasOverride: true,
                  overrideSource: 'manual',
                }
              : r,
          ),
        );
      }

      // Merge with the existing override: saving one field (e.g. dispatch) must not
      // wipe the others (driver paid, comment…). `undefined` = keep; `null` = clear.
      const keep = <T,>(next: T | undefined, prev: T | null | undefined): T | null =>
        next !== undefined ? next : (prev ?? null);
      const row = {
        tour_id: bare,
        driver_name: keep(patch.driverName, prevOverride?.driverName),
        driver_paid: keep(patch.driverPaid, prevOverride?.driverPaid),
        comment: keep(patch.comment, prevOverride?.comment),
        dispatch: keep(patch.dispatch, prevOverride?.dispatch),
        mile: keep(patch.mile, prevOverride?.mile),
        broker: keep(patch.broker, prevOverride?.broker) ?? 'Amazon',
        source: 'manual',
        updated_at: ts,
      };
      const { error } = await supabase.from('load_overrides').upsert(row, { onConflict: 'tour_id' });
      if (error) {
        toast.error(`Override save failed: ${error.message}`);
        // Soft refresh money rows only
        void fetchReportLoads().then((res) => {
          if (!res.error) setReportLoads(res.data.map((r) => mapReportLoad(r)));
        });
        return;
      }
      toast.success('Saved');
      void fetchReportLoads().then((res) => {
        if (!res.error) setReportLoads(res.data.map((r) => mapReportLoad(r)));
      });
    },
    [loadOverrides, reportLoads],
  );

  const addFee = useCallback(
    (data: Omit<DriverFee, 'id' | 'createdAt' | 'updatedAt'>) => {
      const id = crypto.randomUUID();
      const ts = now();
      const fee: DriverFee = {
        ...data,
        id,
        createdAt: ts,
        updatedAt: ts,
      };
      setDriverFees((prev) => [...prev, fee]);
      void supabase
        .from('driver_fees')
        .insert({
          id,
          driver_id: data.driverId,
          fee_name: data.feeName,
          category: data.category,
          calculation_type: data.calculationType,
          amount: data.amount,
          frequency: data.frequency,
          active: data.active,
          start_date: data.startDate,
          end_date: data.endDate,
          description: data.description,
          created_at: ts,
          updated_at: ts,
        })
        .then(({ error }) => {
          if (error) toast.error(`Fee sync failed: ${error.message}`);
        });
      toast.success('Fee configuration added');
      return fee;
    },
    []
  );

  const updateFee = useCallback((id: string, patch: Partial<DriverFee>) => {
    const ts = now();
    setDriverFees((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch, updatedAt: ts } : f))
    );
    const row: Record<string, unknown> = { updated_at: ts };
    if (patch.feeName != null) row.fee_name = patch.feeName;
    if (patch.category != null) row.category = patch.category;
    if (patch.calculationType != null) row.calculation_type = patch.calculationType;
    if (patch.amount != null) row.amount = patch.amount;
    if (patch.frequency != null) row.frequency = patch.frequency;
    if (patch.active != null) row.active = patch.active;
    if (patch.startDate != null) row.start_date = patch.startDate;
    if (patch.endDate !== undefined) row.end_date = patch.endDate;
    if (patch.description != null) row.description = patch.description;
    void supabase.from('driver_fees').update(row).eq('id', id);
    toast.success('Fee updated');
  }, []);

  const deleteFee = useCallback((id: string) => {
    setDriverFees((prev) => prev.filter((f) => f.id !== id));
    void supabase.from('driver_fees').delete().eq('id', id);
    toast.success('Fee removed');
  }, []);

  const addOneTimeCharge = useCallback(
    (data: Omit<OneTimeCharge, 'id' | 'createdAt'>) => {
      const id = crypto.randomUUID();
      const ts = now();
      const charge: OneTimeCharge = { ...data, id, createdAt: ts };
      setOneTimeCharges((prev) => [...prev, charge]);
      void supabase
        .from('one_time_charges')
        .insert({
          id,
          driver_id: data.driverId,
          description: data.description,
          amount: data.amount,
          date: data.date,
          settlement_week_start: data.settlementWeekStart,
          category: data.category,
          notes: data.notes,
          created_at: ts,
        })
        .then(({ error }) => {
          if (error) toast.error(`Charge sync failed: ${error.message}`);
        });
      // Recalculate non-finalized settlement for that week
      setSettlements((prev) =>
        prev.map((s) => {
          if (
            s.driverId === data.driverId &&
            s.weekStart === data.settlementWeekStart &&
            !s.finalized
          ) {
            const refreshed = computeOrRefreshSettlement(
              s,
              s.driverId,
              s.weekStart,
              loads,
              driverFees,
              [...oneTimeCharges, charge],
              grossAdjustments
            );
            return { ...s, ...refreshed };
          }
          return s;
        })
      );
      logActivity({
        type: 'charge',
        action: 'added',
        description: `One-time charge: ${data.description} ($${data.amount})`,
        entityId: charge.id,
      });
      toast.success('One-time charge added');
      return charge;
    },
    [loads, driverFees, oneTimeCharges, grossAdjustments, logActivity]
  );

  const updateOneTimeCharge = useCallback(
    (id: string, patch: Partial<OneTimeCharge>) => {
      setOneTimeCharges((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
      );
      toast.success('Charge updated');
    },
    []
  );

  const deleteOneTimeCharge = useCallback(
    (id: string) => {
      const charge = oneTimeCharges.find((c) => c.id === id);
      setOneTimeCharges((prev) => prev.filter((c) => c.id !== id));
      if (charge) {
        setSettlements((prev) =>
          prev.map((s) => {
            if (
              s.driverId === charge.driverId &&
              s.weekStart === charge.settlementWeekStart &&
              !s.finalized
            ) {
              const remaining = oneTimeCharges.filter((c) => c.id !== id);
              const refreshed = computeOrRefreshSettlement(
                s,
                s.driverId,
                s.weekStart,
                loads,
                driverFees,
                remaining,
                grossAdjustments
              );
              return { ...s, ...refreshed };
            }
            return s;
          })
        );
      }
      toast.success('Charge removed');
    },
    [oneTimeCharges, loads, driverFees, grossAdjustments]
  );

  const getSettlement = useCallback(
    (id: string) => settlements.find((s) => s.id === id),
    [settlements]
  );

  const getOrCreateSettlement = useCallback(
    (driverId: string, weekStart: string) => {
      const existing = settlements.find(
        (s) => s.driverId === driverId && s.weekStart === weekStart
      );
      if (existing) {
        if (!existing.finalized) {
          const refreshed = computeOrRefreshSettlement(
            existing,
            driverId,
            weekStart,
            loads,
            driverFees,
            oneTimeCharges,
            grossAdjustments
          );
          const updated = { ...existing, ...refreshed };
          setSettlements((prev) =>
            prev.map((s) => (s.id === existing.id ? updated : s))
          );
          return updated;
        }
        return existing;
      }
      const computed = computeOrRefreshSettlement(
        undefined,
        driverId,
        weekStart,
        loads,
        driverFees,
        oneTimeCharges,
        grossAdjustments
      );
      const settlement: Settlement = {
        ...computed,
        id: generateId('set'),
        createdAt: now(),
      };
      setSettlements((prev) => [...prev, settlement]);
      return settlement;
    },
    [settlements, loads, driverFees, oneTimeCharges, grossAdjustments]
  );

  const recalculateSettlement = useCallback(
    (id: string) => {
      setSettlements((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          if (s.finalized) {
            toast.error('Cannot recalculate a finalized settlement');
            return s;
          }
          const refreshed = computeOrRefreshSettlement(
            s,
            s.driverId,
            s.weekStart,
            loads,
            driverFees,
            oneTimeCharges,
            grossAdjustments
          );
          toast.success('Settlement recalculated');
          return { ...s, ...refreshed };
        })
      );
    },
    [loads, driverFees, oneTimeCharges, grossAdjustments]
  );

  const updateSettlementStatus = useCallback(
    (id: string, status: Settlement['status']) => {
      setSettlements((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status, updatedAt: now() } : s
        )
      );
      logActivity({
        type: 'settlement',
        action: 'status',
        description: `Settlement status changed to ${status}`,
        entityId: id,
      });
      toast.success(`Settlement marked as ${status}`);
    },
    [logActivity]
  );

  const finalizeSettlement = useCallback(
    (id: string) => {
      setSettlements((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, finalized: true, status: s.status === 'Draft' ? 'Approved' : s.status, updatedAt: now() }
            : s
        )
      );
      logActivity({
        type: 'settlement',
        action: 'approved',
        description: 'Settlement finalized/approved',
        entityId: id,
      });
      toast.success('Settlement approved and locked');
    },
    [logActivity]
  );

  const markSettlementPaid = useCallback(
    (id: string, payment: Omit<SettlementPayment, 'id'>) => {
      setSettlements((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          const newPayment: SettlementPayment = {
            ...payment,
            id: generateId('pay'),
          };
          const amountPaid = round2(s.amountPaid + payment.amount);
          const rem = round2(s.netPayable - amountPaid);
          let status: Settlement['status'] = 'Partially Paid';
          if (rem <= 0) status = 'Paid';
          else if (amountPaid === 0) status = s.status;
          return {
            ...s,
            amountPaid,
            status,
            paymentDate: payment.date,
            payments: [...s.payments, newPayment],
            finalized: true,
            updatedAt: now(),
          };
        })
      );
      logActivity({
        type: 'payment',
        action: 'paid',
        description: `Payment of $${payment.amount.toFixed(2)} recorded`,
        entityId: id,
      });
      toast.success('Payment recorded');
    },
    [logActivity]
  );

  const addSettlementAdjustment = useCallback(
    (id: string, adjustment: Omit<SettlementAdjustment, 'id'>) => {
      setSettlements((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          const adj: SettlementAdjustment = {
            ...adjustment,
            id: generateId('adj'),
          };
          const adjustments = [...s.adjustments, adj];
          const totalDeductions = round2(
            s.charges.reduce((sum, c) => sum + c.appliedAmount, 0) +
              adjustments.reduce((sum, a) => sum + a.amount, 0)
          );
          const netPayable = round2(s.weeklyGross - totalDeductions);
          return {
            ...s,
            adjustments,
            totalDeductions,
            netPayable,
            updatedAt: now(),
          };
        })
      );
      toast.success('Adjustment recorded');
    },
    []
  );

  const addGrossAdjustment = useCallback(
    (adj: Omit<GrossAdjustment, 'id' | 'createdAt'>) => {
      const entry: GrossAdjustment = {
        ...adj,
        id: generateId('ga'),
        createdAt: now(),
      };
      setGrossAdjustments((prev) => [...prev, entry]);
      toast.success('Gross adjustment added');
    },
    []
  );

  const updateSettings = useCallback((patch: Partial<CompanySettings>) => {
    setCompanySettings((prev) => {
      const next = { ...prev, ...patch };
      if (patch.historyRetentionDays != null) {
        void supabase
          .from('retention_settings')
          .upsert({
            id: 1,
            history_retention_days: Math.max(1, Number(patch.historyRetentionDays) || 45),
            updated_at: now(),
          })
          .then(({ error }) => {
            if (error) console.error('retention_settings update failed', error.message);
          });
      }
      return next;
    });
    toast.success('Settings saved');
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({
      drivers,
      loads,
      relayTrips,
      relaySnapshots,
      relaySyncHealth,
      loadReports,
      reportLoads,
      loadOverrides,
      payments,
      invoices,
      invoiceTrips,
      paymentsSummary,
      driverFees,
      oneTimeCharges,
      settlements,
      activityLogs,
      grossAdjustments,
      syncState,
      extensionHeartbeat,
      sectionSnapshots,
      tripSummaries,
      currentUser,
      companySettings,
      dataSource: 'supabase',
      dataReady,
      dataError,
      dataFetching,
      tripSectionCounts,
      refreshData: () => hydrate(),
      ensureHistoryTrips,
      ensureTripStops,
      addDriver,
      updateDriver,
      deactivateDriver,
      getDriver,
      addLoad,
      updateLoad,
      deleteLoad,
      getLoad,
      addLoadReport,
      updateLoadReport,
      deleteLoadReport,
      syncLoadReportsForRange,
      upsertLoadOverride,
      addFee,
      updateFee,
      deleteFee,
      addOneTimeCharge,
      updateOneTimeCharge,
      deleteOneTimeCharge,
      getSettlement,
      getOrCreateSettlement,
      recalculateSettlement,
      updateSettlementStatus,
      finalizeSettlement,
      markSettlementPaid,
      addSettlementAdjustment,
      addGrossAdjustment,
      updateSettings,
      logActivity,
    }),
    [
      drivers,
      loads,
      relayTrips,
      relaySnapshots,
      relaySyncHealth,
      loadReports,
      reportLoads,
      loadOverrides,
      payments,
      invoices,
      invoiceTrips,
      paymentsSummary,
      driverFees,
      oneTimeCharges,
      settlements,
      activityLogs,
      grossAdjustments,
      syncState,
      extensionHeartbeat,
      sectionSnapshots,
      tripSummaries,
      currentUser,
      companySettings,
      dataReady,
      dataError,
      dataFetching,
      tripSectionCounts,
      hydrate,
      ensureHistoryTrips,
      ensureTripStops,
      addDriver,
      updateDriver,
      deactivateDriver,
      getDriver,
      addLoad,
      updateLoad,
      deleteLoad,
      getLoad,
      addLoadReport,
      updateLoadReport,
      deleteLoadReport,
      syncLoadReportsForRange,
      upsertLoadOverride,
      addFee,
      updateFee,
      deleteFee,
      addOneTimeCharge,
      updateOneTimeCharge,
      deleteOneTimeCharge,
      getSettlement,
      getOrCreateSettlement,
      recalculateSettlement,
      updateSettlementStatus,
      finalizeSettlement,
      markSettlementPaid,
      addSettlementAdjustment,
      addGrossAdjustment,
      updateSettings,
      logActivity,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}

// Re-export helper used by pages
export { remainingBalance, getWeekRange };
