import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
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
} from '@/types';
import {
  drivers as seedDrivers,
  loads as seedLoads,
  driverFees as seedFees,
  oneTimeCharges as seedCharges,
  settlements as seedSettlements,
  activityLogs as seedActivity,
  grossAdjustments as seedAdjustments,
  currentUser as seedUser,
  companySettings as seedSettings,
} from '@/data/sampleData';
import { computeOrRefreshSettlement, remainingBalance } from '@/lib/calculations';
import { generateId, getWeekRange } from '@/lib/utils';
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

interface DataContextValue {
  drivers: Driver[];
  loads: Load[];
  driverFees: DriverFee[];
  oneTimeCharges: OneTimeCharge[];
  settlements: Settlement[];
  activityLogs: ActivityLog[];
  grossAdjustments: GrossAdjustment[];
  currentUser: AppUser;
  companySettings: CompanySettings;
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
  const [drivers, setDrivers] = useState<Driver[]>(seedDrivers);
  const [loads, setLoads] = useState<Load[]>(seedLoads);
  const [driverFees, setDriverFees] = useState<DriverFee[]>(seedFees);
  const [oneTimeCharges, setOneTimeCharges] = useState<OneTimeCharge[]>(seedCharges);
  const [settlements, setSettlements] = useState<Settlement[]>(seedSettlements);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(seedActivity);
  const [grossAdjustments, setGrossAdjustments] =
    useState<GrossAdjustment[]>(seedAdjustments);
  const [currentUser] = useState<AppUser>(seedUser);
  const [companySettings, setCompanySettings] = useState<CompanySettings>(seedSettings);

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
      const driver: Driver = {
        ...data,
        id: generateId('drv'),
        createdAt: now(),
        updatedAt: now(),
      };
      setDrivers((prev) => [...prev, driver]);
      logActivity({
        type: 'driver',
        action: 'created',
        description: `Driver ${data.firstName} ${data.lastName} added`,
        entityId: driver.id,
      });
      toast.success('Driver added successfully');
      return driver;
    },
    [logActivity]
  );

  const updateDriver = useCallback(
    (id: string, patch: Partial<Driver>) => {
      setDrivers((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: now() } : d))
      );
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
      const fee: DriverFee = {
        ...data,
        id: generateId('fee'),
        createdAt: now(),
        updatedAt: now(),
      };
      setDriverFees((prev) => [...prev, fee]);
      toast.success('Fee configuration added');
      return fee;
    },
    []
  );

  const updateFee = useCallback((id: string, patch: Partial<DriverFee>) => {
    setDriverFees((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch, updatedAt: now() } : f))
    );
    toast.success('Fee updated');
  }, []);

  const deleteFee = useCallback((id: string) => {
    setDriverFees((prev) => prev.filter((f) => f.id !== id));
    toast.success('Fee removed');
  }, []);

  const addOneTimeCharge = useCallback(
    (data: Omit<OneTimeCharge, 'id' | 'createdAt'>) => {
      const charge: OneTimeCharge = { ...data, id: generateId('otc'), createdAt: now() };
      setOneTimeCharges((prev) => [...prev, charge]);
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
      driverFees,
      oneTimeCharges,
      settlements,
      activityLogs,
      grossAdjustments,
      currentUser,
      companySettings,
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
      driverFees,
      oneTimeCharges,
      settlements,
      activityLogs,
      grossAdjustments,
      currentUser,
      companySettings,
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
