import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
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
import {
  supabase,
  fetchAllPages,
  RELAY_TRIP_LIST_COLUMNS,
  RELAY_LEG_LIST_COLUMNS,
  RELAY_STOP_LIST_COLUMNS,
} from '@/lib/supabase';
import {
  assembleRelayTrips,
  loadReportToRow,
  mapActivity,
  mapCharge,
  mapDriver,
  mapFee,
  mapLoad,
  mapLoadReport,
  mapRelayPayment,
  mapRelaySectionSnapshot,
  mapSettlement,
  mapExtensionHeartbeat,
  mapSyncState,
  mapTripSummary,
} from '@/lib/supabaseMappers';
import { computeSyncHealth } from '@/lib/relayTrips';
import { DEFAULT_HISTORY_RETENTION_DAYS } from '@/lib/liveMirrors';
import {
  buildReportFromLoad,
  isBadReportLocation,
  loadInDateRange,
  sanitizeReportLocation,
} from '@/lib/reportRows';
import {
  mapLoadOverride,
  mapReportLoad,
  type LoadOverrideRow,
  type ReportLoadRow,
} from '@/lib/reportLoadMoney';
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
  refreshData: () => Promise<void>;
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

  /** Hydrate from Supabase iiyqkdjwxlnfqvlidbqr — live Relay extension data. */
  const hydrate = useCallback(async () => {
    let relayTripsRes: { data: Record<string, unknown>[]; error: { message: string } | null };
    let relayLegsRes: { data: Record<string, unknown>[]; error: { message: string } | null };
    let relayStopsRes: { data: Record<string, unknown>[]; error: { message: string } | null };
    let heartbeatEarly: {
      data: Record<string, unknown> | null;
      error: { message: string } | null;
    } | null = null;
    try {
      [relayTripsRes, relayLegsRes, relayStopsRes, heartbeatEarly] = await Promise.all([
        fetchAllPages<Record<string, unknown>>((from, to) =>
          supabase
            .from('relay_trips')
            .select(RELAY_TRIP_LIST_COLUMNS)
            .eq('archived', false)
            .order('last_seen_at', { ascending: false })
            .range(from, to),
        ),
        fetchAllPages<Record<string, unknown>>((from, to) =>
          supabase
            .from('relay_legs')
            .select(RELAY_LEG_LIST_COLUMNS)
            .eq('archived', false)
            .range(from, to),
        ),
        fetchAllPages<Record<string, unknown>>((from, to) =>
          supabase
            .from('relay_stops')
            .select(RELAY_STOP_LIST_COLUMNS)
            .eq('archived', false)
            .order('seq', { ascending: true })
            .range(from, to),
        ),
        supabase.from('extension_heartbeat').select('*').eq('id', 1).maybeSingle(),
      ]);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Relay hydrate failed';
      console.error('Relay trips hydrate threw', message);
      setDataError(message);
      setDataReady(true);
      // Keep previous relayTrips — never blank the Trips page on error.
      // Still refresh liveness so offline chip stays honest during hydrate failures.
      void supabase
        .from('extension_heartbeat')
        .select('*')
        .eq('id', 1)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error) return;
          setExtensionHeartbeat(data ? mapExtensionHeartbeat(data as Record<string, unknown>) : null);
        });
      return;
    }

    const [
      driversRes,
      loadsRes,
      relaySnapshotsRes,
      syncRunsRes,
      loadReportsRes,
      reportLoadsRes,
      loadOverridesRes,
      feesRes,
      chargesRes,
      settlementsRes,
      settlementLoadsRes,
      settlementChargesRes,
      paymentsRes,
      invoicesRes,
      invoiceTripsRes,
      paymentsSummaryRes,
      activityRes,
      syncStateRes,
      summariesRes,
      retentionRes,
    ] = await Promise.all([
      supabase.from('drivers').select('*').order('created_at', { ascending: true }),
      supabase.from('loads').select('*').order('created_at', { ascending: false }),
      supabase.from('relay_section_snapshots').select('*'),
      supabase
        .from('relay_sync_runs')
        .select('finished_at, status, error_count')
        .order('started_at', { ascending: false })
        .limit(5),
      supabase.from('load_reports').select('*').order('pickup_date', { ascending: true }),
      fetchAllPages<Record<string, unknown>>((from, to) =>
        supabase
          .from('report_loads')
          .select('*')
          .order('tour_start_la', { ascending: true })
          .range(from, to),
      ),
      supabase.from('load_overrides').select('*'),
      supabase.from('driver_fees').select('*'),
      supabase.from('one_time_charges').select('*'),
      supabase.from('settlements').select('*'),
      supabase.from('settlement_loads').select('*'),
      supabase.from('settlement_charges').select('*'),
      supabase.from('payments').select('*').order('payment_date', { ascending: false }),
      // FIXTURE-* verification seeds never hydrate into CRM totals/reports
      supabase
        .from('invoices')
        .select('*')
        .not('invoice_id', 'like', 'FIXTURE-%')
        .order('week_start', { ascending: false }),
      supabase
        .from('invoice_trips')
        .select('*')
        .not('invoice_id', 'like', 'FIXTURE-%'),
      supabase.from('payments_summary').select('*').eq('id', 1).maybeSingle(),
      supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('sync_state').select('*'),
      supabase.from('trip_summaries').select('*').order('end_time', { ascending: false }).limit(500),
      supabase.from('retention_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    const heartbeatRes = heartbeatEarly;

    const err =
      driversRes.error ||
      loadsRes.error ||
      loadReportsRes.error ||
      feesRes.error ||
      chargesRes.error ||
      settlementsRes.error ||
      settlementLoadsRes.error ||
      settlementChargesRes.error ||
      paymentsRes.error ||
      invoicesRes.error ||
      invoiceTripsRes.error ||
      activityRes.error;
    const relayErr =
      relayTripsRes.error ||
      relayLegsRes.error ||
      relayStopsRes.error ||
      relaySnapshotsRes.error ||
      syncRunsRes.error;
    if (err) {
      console.error('Supabase CRM hydrate failed', err.message);
      setDataError(err.message);
      setDataReady(true);
      return;
    }
    if (relayErr) {
      console.error('Relay trips hydrate failed', relayErr.message);
      setDataError(relayErr.message);
      setDataReady(true);
      // Keep previous relayTrips / snapshots — never replace with [] on error.
      // Still apply heartbeat + sync_state so offline/delayed banners stay accurate.
      if (heartbeatRes && !heartbeatRes.error) {
        setExtensionHeartbeat(
          heartbeatRes.data
            ? mapExtensionHeartbeat(heartbeatRes.data as Record<string, unknown>)
            : null,
        );
      }
      if (!syncStateRes.error) {
        setSyncState((syncStateRes.data || []).map((r) => mapSyncState(r as Record<string, unknown>)));
      }
      return;
    }

    setDataError(null);

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

    setDrivers((driversRes.data || []).map((r) => mapDriver(r as Record<string, unknown>)));
    setLoads((loadsRes.data || []).map((r) => mapLoad(r as Record<string, unknown>)));

    const assembledTrips = assembleRelayTrips(
      relayTripsRes.data,
      relayLegsRes.data,
      relayStopsRes.data,
    );
    const snapshots = (relaySnapshotsRes.data || [])
      .map((r) => mapRelaySectionSnapshot(r as Record<string, unknown>))
      .filter((s): s is RelaySectionSnapshot => Boolean(s));
    const lastRunFinished =
      (syncRunsRes.data || [])
        .map((r) => (r as { finished_at?: string | null }).finished_at)
        .find((v) => Boolean(v)) || null;
    setRelayTrips(assembledTrips);
    setRelaySnapshots(snapshots);
    setSectionSnapshots(snapshots);
    setRelaySyncHealth(computeSyncHealth(snapshots, assembledTrips, lastRunFinished));

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
    if (!summariesRes.error) {
      setTripSummaries(
        (summariesRes.data || []).map((r) => mapTripSummary(r as Record<string, unknown>)),
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

    setLoadReports(
      (loadReportsRes.data || []).map((r) => mapLoadReport(r as Record<string, unknown>)),
    );
    if (!reportLoadsRes.error) {
      setReportLoads((reportLoadsRes.data || []).map((r) => mapReportLoad(r)));
    } else {
      console.error('report_loads hydrate failed', reportLoadsRes.error.message);
    }
    if (!loadOverridesRes.error) {
      setLoadOverrides(
        (loadOverridesRes.data || []).map((r) => mapLoadOverride(r as Record<string, unknown>)),
      );
    }
    setPayments(mappedPayments);
    setInvoices(
      excludeFixtureInvoices(
        (invoicesRes.data || []).map((r) => mapInvoice(r as Record<string, unknown>)),
      ),
    );
    setInvoiceTrips(
      excludeFixtureInvoices(
        (invoiceTripsRes.data || []).map((r) => mapInvoiceTrip(r as Record<string, unknown>)),
      ),
    );
    setPaymentsSummary(
      paymentsSummaryRes.data
        ? mapPaymentsSummary(paymentsSummaryRes.data as Record<string, unknown>)
        : null,
    );
    setDriverFees((feesRes.data || []).map((r) => mapFee(r as Record<string, unknown>)));
    setOneTimeCharges((chargesRes.data || []).map((r) => mapCharge(r as Record<string, unknown>)));
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
    setActivityLogs((activityRes.data || []).map((r) => mapActivity(r as Record<string, unknown>)));
    setDataReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void hydrate().then(() => {
      if (cancelled) return;
    });
    const timer = window.setInterval(() => {
      if (!cancelled) void hydrate();
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
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

  const syncLoadReportsForRange = useCallback(
    async (start: string, end: string, opts?: { quiet?: boolean }) => {
      const byUuid = new Map(
        loadReports.filter((r) => r.loadUuid).map((r) => [r.loadUuid as string, r]),
      );
      const missing = loads.filter(
        (l) => loadInDateRange(l, start, end) && !byUuid.has(l.id),
      );

      // Refresh PU/Del when report still has Unknown / $ / scraps but load has a real place
      const locationFixes: { id: string; puLocation: string; delLocation: string }[] = [];
      for (const load of loads) {
        if (!loadInDateRange(load, start, end)) continue;
        const existing = byUuid.get(load.id);
        if (!existing) continue;
        const nextPu = sanitizeReportLocation(load.pickupLocation);
        const nextDel = sanitizeReportLocation(load.deliveryLocation);
        const fixPu = isBadReportLocation(existing.puLocation) && Boolean(nextPu);
        const fixDel = isBadReportLocation(existing.delLocation) && Boolean(nextDel);
        if (!fixPu && !fixDel) continue;
        locationFixes.push({
          id: existing.id,
          puLocation: fixPu ? nextPu : sanitizeReportLocation(existing.puLocation),
          delLocation: fixDel ? nextDel : sanitizeReportLocation(existing.delLocation),
        });
      }

      if (!missing.length && !locationFixes.length) {
        if (!opts?.quiet) toast.message('Reports already up to date for this range');
        return 0;
      }

      const ts = now();
      let changed = 0;

      if (missing.length) {
        const rows: LoadReport[] = missing.map((load) => {
          const base = buildReportFromLoad(load, drivers, '', 'sync');
          return {
            ...base,
            id: crypto.randomUUID(),
            createdAt: ts,
            updatedAt: ts,
          };
        });
        setLoadReports((prev) => [...prev, ...rows]);
        const { error } = await supabase
          .from('load_reports')
          .insert(rows.map((r) => loadReportToRow(r)));
        if (error) {
          toast.error(`Sync failed: ${error.message}`);
          await hydrate();
          return 0;
        }
        changed += rows.length;
      }

      if (locationFixes.length) {
        setLoadReports((prev) =>
          prev.map((r) => {
            const fix = locationFixes.find((f) => f.id === r.id);
            return fix
              ? {
                  ...r,
                  puLocation: fix.puLocation,
                  delLocation: fix.delLocation,
                  updatedAt: ts,
                }
              : r;
          }),
        );
        for (const fix of locationFixes) {
          const { error } = await supabase
            .from('load_reports')
            .update({
              pu_location: fix.puLocation,
              del_location: fix.delLocation,
              updated_at: ts,
            })
            .eq('id', fix.id);
          if (error) {
            toast.error(`Location refresh failed: ${error.message}`);
            await hydrate();
            return changed;
          }
        }
        changed += locationFixes.length;
      }

      if (!opts?.quiet) {
        const bits = [];
        if (missing.length) bits.push(`${missing.length} new`);
        if (locationFixes.length) bits.push(`${locationFixes.length} locations refreshed`);
        toast.success(`Synced Reports (${bits.join(', ')})`);
      }
      await hydrate();
      return changed;
    },
    [drivers, hydrate, loadReports, loads],
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
      const row = {
        tour_id: bare,
        driver_name: patch.driverName ?? null,
        driver_paid: patch.driverPaid ?? null,
        comment: patch.comment ?? null,
        dispatch: patch.dispatch ?? null,
        mile: patch.mile ?? null,
        broker: patch.broker ?? 'Amazon',
        source: 'manual',
        updated_at: now(),
      };
      const { error } = await supabase.from('load_overrides').upsert(row, { onConflict: 'tour_id' });
      if (error) {
        toast.error(`Override save failed: ${error.message}`);
        return;
      }
      toast.success('Saved');
      await hydrate();
    },
    [hydrate],
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
      refreshData: hydrate,
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
      hydrate,
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
