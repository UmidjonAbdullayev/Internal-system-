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
  DriverFee,
  OneTimeCharge,
  Settlement,
  ActivityLog,
  GrossAdjustment,
  SettlementPayment,
  SettlementAdjustment,
  AppUser,
  RelayPayment,
} from '@/types';
import { computeOrRefreshSettlement, remainingBalance } from '@/lib/calculations';
import { generateId, getWeekRange } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import {
  mapActivity,
  mapCharge,
  mapDriver,
  mapFee,
  mapLoad,
  mapRelayPayment,
  mapSettlement,
} from '@/lib/supabaseMappers';
import { toast } from 'sonner';

interface CompanySettings {
  companyName: string;
  companyAddress: string;
  ein: string;
  weekStartsOn: 0 | 1;
  defaultDispatchFeePercent: number;
  currency: string;
  timezone: string;
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
  weekStartsOn: 1,
  defaultDispatchFeePercent: 10,
  currency: 'USD',
  timezone: 'America/Chicago',
};

interface DataContextValue {
  drivers: Driver[];
  loads: Load[];
  payments: RelayPayment[];
  driverFees: DriverFee[];
  oneTimeCharges: OneTimeCharge[];
  settlements: Settlement[];
  activityLogs: ActivityLog[];
  grossAdjustments: GrossAdjustment[];
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
  const [payments, setPayments] = useState<RelayPayment[]>([]);
  const [driverFees, setDriverFees] = useState<DriverFee[]>([]);
  const [oneTimeCharges, setOneTimeCharges] = useState<OneTimeCharge[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [grossAdjustments, setGrossAdjustments] = useState<GrossAdjustment[]>([]);
  const [currentUser] = useState<AppUser>(EMPTY_USER);
  const [companySettings, setCompanySettings] = useState<CompanySettings>(EMPTY_SETTINGS);
  const [dataReady, setDataReady] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  /** Hydrate from Supabase iiyqkdjwxlnfqvlidbqr — live Relay extension data. */
  const hydrate = useCallback(async () => {
    const [
      driversRes,
      loadsRes,
      feesRes,
      chargesRes,
      settlementsRes,
      settlementLoadsRes,
      settlementChargesRes,
      paymentsRes,
      activityRes,
    ] = await Promise.all([
      supabase.from('drivers').select('*').order('created_at', { ascending: true }),
      supabase.from('loads').select('*').order('created_at', { ascending: false }),
      supabase.from('driver_fees').select('*'),
      supabase.from('one_time_charges').select('*'),
      supabase.from('settlements').select('*'),
      supabase.from('settlement_loads').select('*'),
      supabase.from('settlement_charges').select('*'),
      supabase.from('payments').select('*').order('payment_date', { ascending: false }),
      supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(100),
    ]);

    const err =
      driversRes.error ||
      loadsRes.error ||
      feesRes.error ||
      chargesRes.error ||
      settlementsRes.error ||
      settlementLoadsRes.error ||
      settlementChargesRes.error ||
      paymentsRes.error ||
      activityRes.error;
    if (err) {
      console.error('Supabase CRM hydrate failed', err.message);
      setDataError(err.message);
      setDataReady(true);
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
    setPayments(mappedPayments);
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
    setCompanySettings((prev) => ({ ...prev, ...patch }));
    toast.success('Settings saved');
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({
      drivers,
      loads,
      payments,
      driverFees,
      oneTimeCharges,
      settlements,
      activityLogs,
      grossAdjustments,
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
      payments,
      driverFees,
      oneTimeCharges,
      settlements,
      activityLogs,
      grossAdjustments,
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
