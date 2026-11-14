import type {
  ActivityLog,
  Driver,
  DriverFee,
  DriverStatus,
  Load,
  LoadStatus,
  OneTimeCharge,
  PaymentStatus,
  RelayPayment,
  Settlement,
  SettlementStatus,
  TrailerType,
} from '@/types';

function str(v: unknown, fallback = ''): string {
  return v == null ? fallback : String(v);
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function mapDriver(row: Record<string, unknown>): Driver {
  return {
    id: str(row.id),
    driverId: str(row.driver_id),
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    phone: str(row.phone),
    email: str(row.email),
    status: (str(row.status, 'Active') as DriverStatus) || 'Active',
    assignedTruck: str(row.assigned_truck),
    trailerId: str(row.trailer_id),
    hireDate: str(row.hire_date),
    notes: str(row.notes),
    address: str(row.address),
    city: str(row.city),
    state: str(row.state),
    zip: str(row.zip),
    licenseNumber: str(row.license_number),
    licenseExpiry: str(row.license_expiry),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export function mapLoad(row: Record<string, unknown>): Load {
  const history = Array.isArray(row.status_history) ? row.status_history : [];
  return {
    id: str(row.id),
    loadId: str(row.load_id),
    amazonRefId: str(row.amazon_ref_id),
    driverId: row.driver_id ? str(row.driver_id) : null,
    loadStatus: str(row.load_status, 'Available') as LoadStatus,
    paymentStatus: str(row.payment_status, 'Not Received') as PaymentStatus,
    pickupLocation: str(row.pickup_location),
    deliveryLocation: str(row.delivery_location),
    pickupDate: str(row.pickup_date),
    deliveryDate: str(row.delivery_date),
    trailerId: str(row.trailer_id),
    trailerType: (str(row.trailer_type, 'Dry Van') as TrailerType) || 'Dry Van',
    distanceMiles: num(row.distance_miles),
    rateGross: num(row.rate_gross),
    additionalCharges: num(row.additional_charges),
    paymentDate: row.payment_date ? str(row.payment_date) : null,
    notes: str(row.notes),
    statusHistory: history as Load['statusHistory'],
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export function mapFee(row: Record<string, unknown>): DriverFee {
  return {
    id: str(row.id),
    driverId: str(row.driver_id),
    feeName: str(row.fee_name),
    category: row.category as DriverFee['category'],
    calculationType: row.calculation_type as DriverFee['calculationType'],
    amount: num(row.amount),
    frequency: row.frequency as DriverFee['frequency'],
    active: Boolean(row.active),
    startDate: str(row.start_date),
    endDate: row.end_date ? str(row.end_date) : null,
    description: str(row.description),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export function mapCharge(row: Record<string, unknown>): OneTimeCharge {
  return {
    id: str(row.id),
    driverId: str(row.driver_id),
    description: str(row.description),
    amount: num(row.amount),
    date: str(row.charge_date),
    settlementWeekStart: str(row.settlement_week_start),
    category: row.category as OneTimeCharge['category'],
    notes: str(row.notes),
    createdAt: str(row.created_at),
  };
}

export function mapSettlement(
  row: Record<string, unknown>,
  loadIds: string[] = [],
  charges: Settlement['charges'] = [],
  payments: Settlement['payments'] = [],
): Settlement {
  return {
    id: str(row.id),
    driverId: str(row.driver_id),
    weekStart: str(row.week_start),
    weekEnd: str(row.week_end),
    weeklyGross: num(row.weekly_gross),
    totalDeductions: num(row.total_deductions),
    netPayable: num(row.net_payable),
    amountPaid: num(row.amount_paid),
    status: str(row.status, 'Draft') as SettlementStatus,
    paymentDate: row.payment_date ? str(row.payment_date) : null,
    charges,
    loadIds,
    payments,
    adjustments: [],
    finalized: Boolean(row.finalized),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export function mapActivity(row: Record<string, unknown>): ActivityLog {
  return {
    id: str(row.id),
    type: str(row.type) as ActivityLog['type'],
    action: str(row.action),
    description: str(row.description),
    entityId: row.entity_id ? str(row.entity_id) : undefined,
    timestamp: str(row.created_at),
    user: str(row.user_name, 'System'),
  };
}

export function mapRelayPayment(row: Record<string, unknown>): RelayPayment {
  return {
    id: str(row.id),
    settlementId: row.settlement_id ? str(row.settlement_id) : null,
    loadId: row.load_id ? str(row.load_id) : null,
    paymentDate: str(row.payment_date),
    method: str(row.method),
    referenceId: str(row.reference_id),
    amount: num(row.amount),
    notes: str(row.notes),
    amazonRefId: str(row.amazon_ref_id),
    source: str(row.source, 'amazon_relay'),
    createdAt: str(row.created_at),
    lastSynchronized: row.last_synchronized ? str(row.last_synchronized) : null,
  };
}
