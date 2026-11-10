import { parseISO, getDay, format, startOfWeek, endOfWeek, subWeeks } from 'date-fns';
import type {
  Driver,
  Load,
  DriverFee,
  OneTimeCharge,
  Settlement,
  SettlementChargeSnapshot,
  GrossAdjustment,
  DateRange,
} from '@/types';
import { roundMoney, isDateInRange, getWeekRange } from './utils';

/** Loads that count toward driver earnings */
export function isEligibleLoad(load: Load): boolean {
  return load.loadStatus === 'Completed' || load.loadStatus === 'Delivered';
}

export function getLoadFinalGross(load: Load): number {
  return roundMoney(load.rateGross + load.additionalCharges);
}

export function getEligibleLoads(
  loads: Load[],
  driverId?: string | null,
  range?: DateRange
): Load[] {
  return loads.filter((load) => {
    if (!isEligibleLoad(load)) return false;
    if (driverId && load.driverId !== driverId) return false;
    if (range && !isDateInRange(load.deliveryDate, range)) return false;
    return true;
  });
}

export function sumGross(loads: Load[]): number {
  return roundMoney(loads.reduce((sum, l) => sum + getLoadFinalGross(l), 0));
}

export function getDriverGross(
  loads: Load[],
  driverId: string,
  range?: DateRange,
  adjustments: GrossAdjustment[] = []
): number {
  const eligible = getEligibleLoads(loads, driverId, range);
  const gross = sumGross(eligible);
  const adj = adjustments
    .filter((a) => a.driverId === driverId && (!range || isDateInRange(a.date, range)))
    .reduce((s, a) => s + a.amount, 0);
  return roundMoney(gross + adj);
}

/** Day of week: 0=Sunday ... 6=Saturday. We use Mon=0 index for board. */
export function getDailyGrossByWeekday(
  loads: Load[],
  driverId: string,
  weekRange: DateRange
): number[] {
  // Index: 0=Mon ... 6=Sun
  const daily = [0, 0, 0, 0, 0, 0, 0];
  const eligible = getEligibleLoads(loads, driverId, weekRange);
  for (const load of eligible) {
    const day = getDay(parseISO(load.deliveryDate)); // 0=Sun
    const idx = day === 0 ? 6 : day - 1;
    daily[idx] += getLoadFinalGross(load);
  }
  return daily.map(roundMoney);
}

export function calculateFeeAmount(fee: DriverFee, gross: number, loadCount: number): number {
  if (!fee.active) return 0;
  let base = 0;
  if (fee.calculationType === 'Percentage') {
    base = roundMoney(gross * (fee.amount / 100));
  } else {
    base = fee.amount;
  }
  if (fee.frequency === 'Per Load') {
    return roundMoney(base * loadCount);
  }
  // Weekly / Daily / Monthly treated as once per settlement period when applied weekly
  return roundMoney(base);
}

export function getActiveFeesForPeriod(
  fees: DriverFee[],
  driverId: string,
  weekStart: string
): DriverFee[] {
  return fees.filter((f) => {
    if (f.driverId !== driverId || !f.active) return false;
    if (f.startDate > weekStart) return false;
    if (f.endDate && f.endDate < weekStart) return false;
    return true;
  });
}

export function buildChargeSnapshots(
  fees: DriverFee[],
  oneTimeCharges: OneTimeCharge[],
  driverId: string,
  weekStart: string,
  weeklyGross: number,
  loadCount: number
): SettlementChargeSnapshot[] {
  const activeFees = getActiveFeesForPeriod(fees, driverId, weekStart);
  const snapshots: SettlementChargeSnapshot[] = activeFees.map((fee) => ({
    id: `snap-${fee.id}`,
    chargeName: fee.feeName,
    category: fee.category,
    calculationType: fee.calculationType,
    originalAmountOrRate: fee.amount,
    appliedAmount: calculateFeeAmount(fee, weeklyGross, loadCount),
    frequency: fee.frequency,
    chargeType: 'Recurring' as const,
    sourceId: fee.id,
  }));

  const otc = oneTimeCharges.filter(
    (c) => c.driverId === driverId && c.settlementWeekStart === weekStart
  );
  for (const charge of otc) {
    snapshots.push({
      id: `snap-${charge.id}`,
      chargeName: charge.description,
      category: charge.category,
      calculationType: 'Fixed',
      originalAmountOrRate: charge.amount,
      appliedAmount: charge.amount,
      frequency: 'One-Time',
      chargeType: 'One-Time',
      sourceId: charge.id,
    });
  }

  return snapshots;
}

export function calculateSettlementTotals(
  weeklyGross: number,
  charges: SettlementChargeSnapshot[],
  adjustments: { amount: number }[] = []
) {
  const chargeTotal = roundMoney(charges.reduce((s, c) => s + c.appliedAmount, 0));
  const adjTotal = roundMoney(adjustments.reduce((s, a) => s + a.amount, 0));
  const totalDeductions = roundMoney(chargeTotal + adjTotal);
  const netPayable = roundMoney(weeklyGross - totalDeductions);
  return { totalDeductions, netPayable, chargeTotal, adjTotal };
}

export function remainingBalance(settlement: Settlement): number {
  return roundMoney(settlement.netPayable - settlement.amountPaid);
}

export function categorizeCharges(charges: SettlementChargeSnapshot[]) {
  const fuel = charges.filter((c) => c.category === 'Fuel').reduce((s, c) => s + c.appliedAmount, 0);
  const dispatch = charges
    .filter((c) => c.category === 'Dispatch')
    .reduce((s, c) => s + c.appliedAmount, 0);
  const insurance = charges
    .filter((c) => c.category === 'Insurance')
    .reduce((s, c) => s + c.appliedAmount, 0);
  const equipment = charges
    .filter((c) => ['Equipment', 'Trailer', 'ELD'].includes(c.category))
    .reduce((s, c) => s + c.appliedAmount, 0);
  const other = charges
    .filter((c) => !['Fuel', 'Dispatch', 'Insurance', 'Equipment', 'Trailer', 'ELD'].includes(c.category))
    .reduce((s, c) => s + c.appliedAmount, 0);
  return {
    fuel: roundMoney(fuel),
    dispatch: roundMoney(dispatch),
    insurance: roundMoney(insurance),
    equipment: roundMoney(equipment),
    other: roundMoney(other),
  };
}

export function computeOrRefreshSettlement(
  existing: Settlement | undefined,
  driverId: string,
  weekStart: string,
  loads: Load[],
  fees: DriverFee[],
  oneTimeCharges: OneTimeCharge[],
  adjustments: GrossAdjustment[] = []
): Omit<Settlement, 'id' | 'createdAt'> {
  const weekEnd = format(endOfWeek(parseISO(weekStart), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const range = { start: weekStart, end: weekEnd };
  const eligible = getEligibleLoads(loads, driverId, range);
  const weeklyGross = getDriverGross(loads, driverId, range, adjustments);

  // If finalized, preserve snapshots
  if (existing?.finalized) {
    return {
      ...existing,
      updatedAt: new Date().toISOString(),
    };
  }

  const charges = buildChargeSnapshots(
    fees,
    oneTimeCharges,
    driverId,
    weekStart,
    weeklyGross,
    eligible.length
  );
  const { totalDeductions, netPayable } = calculateSettlementTotals(
    weeklyGross,
    charges,
    existing?.adjustments ?? []
  );

  const amountPaid = existing?.amountPaid ?? 0;
  let status = existing?.status ?? ('Draft' as const);
  if (amountPaid > 0 && amountPaid < netPayable) status = 'Partially Paid';
  if (amountPaid >= netPayable && netPayable > 0) status = 'Paid';

  return {
    driverId,
    weekStart,
    weekEnd,
    weeklyGross,
    totalDeductions,
    netPayable,
    amountPaid,
    status,
    paymentDate: existing?.paymentDate ?? null,
    charges,
    loadIds: eligible.map((l) => l.id),
    payments: existing?.payments ?? [],
    adjustments: existing?.adjustments ?? [],
    finalized: false,
    updatedAt: new Date().toISOString(),
  };
}

export function getFleetGross(loads: Load[], range?: DateRange): number {
  return sumGross(getEligibleLoads(loads, undefined, range));
}

export function getPreviousWeekRange(weekStart: string): DateRange {
  const prev = subWeeks(parseISO(weekStart), 1);
  return getWeekRange(prev);
}

export function percentChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return roundMoney(((current - previous) / previous) * 100);
}

export function getMonthRange(date: Date | string = new Date()): DateRange {
  const d = typeof date === 'string' ? parseISO(date) : date;
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(end, 'yyyy-MM-dd'),
  };
}

export function groupLoadsByStatus(loads: Load[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const load of loads) {
    result[load.loadStatus] = (result[load.loadStatus] ?? 0) + 1;
  }
  return result;
}

export function topDriversByGross(
  drivers: Driver[],
  loads: Load[],
  range: DateRange,
  limit = 5
): { driver: Driver; gross: number; loads: number; avg: number }[] {
  return drivers
    .map((driver) => {
      const eligible = getEligibleLoads(loads, driver.id, range);
      const gross = sumGross(eligible);
      return {
        driver,
        gross,
        loads: eligible.length,
        avg: eligible.length ? roundMoney(gross / eligible.length) : 0,
      };
    })
    .sort((a, b) => b.gross - a.gross)
    .slice(0, limit);
}

export function dailyRevenueSeries(loads: Load[], range: DateRange): { date: string; gross: number }[] {
  const eligible = getEligibleLoads(loads, undefined, range);
  const map = new Map<string, number>();
  let current = parseISO(range.start);
  const end = parseISO(range.end);
  while (current <= end) {
    map.set(format(current, 'yyyy-MM-dd'), 0);
    current = new Date(current.getTime() + 86400000);
  }
  for (const load of eligible) {
    const key = load.deliveryDate;
    if (map.has(key)) {
      map.set(key, roundMoney((map.get(key) ?? 0) + getLoadFinalGross(load)));
    }
  }
  return Array.from(map.entries()).map(([date, gross]) => ({ date, gross }));
}

export function getCurrentWeekStart(ref: Date = new Date()): string {
  return format(startOfWeek(ref, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}
