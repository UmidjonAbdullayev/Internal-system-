import type {
  ActivityLog,
  Driver,
  DriverFee,
  DriverStatus,
  Load,
  LoadReport,
  LoadStatus,
  OneTimeCharge,
  PaymentStatus,
  RelayPayment,
  Settlement,
  SettlementStatus,
  TrailerType,
} from '@/types';
import { sanitizeReportLocation } from '@/lib/reportRows';

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
    driverNameRaw: str(row.driver_name_raw),
    loadStatus: str(row.load_status, 'Available') as LoadStatus,
    paymentStatus: str(row.payment_status, 'Not Received') as PaymentStatus,
    pickupLocation: sanitizeReportLocation(str(row.pickup_location)),
    deliveryLocation: sanitizeReportLocation(str(row.delivery_location)),
    pickupDate: str(row.pickup_date),
    deliveryDate: str(row.delivery_date),
    trailerId: str(row.trailer_id),
    trailerType: (str(row.trailer_type, 'Dry Van') as TrailerType) || 'Dry Van',
    tractorId: str(row.tractor_id),
    parentTripId: row.parent_trip_id ? str(row.parent_trip_id) : null,
    tripBucket: (row.trip_bucket as Load['tripBucket']) || null,
    statusBarState: row.status_bar_state ? str(row.status_bar_state) : null,
    statusStopIndex: row.status_stop_index == null ? null : num(row.status_stop_index),
    arrivalActual: row.arrival_actual ? str(row.arrival_actual) : null,
    arrivalScheduled: row.arrival_scheduled ? str(row.arrival_scheduled) : null,
    arrivalAddress: row.arrival_address ? str(row.arrival_address) : null,
    jobType: row.job_type ? str(row.job_type) : null,
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

export function mapLoadReport(row: Record<string, unknown>): LoadReport {
  const sourceRaw = str(row.source, 'sync');
  const source: LoadReport['source'] =
    sourceRaw === 'auto' || sourceRaw === 'manual' || sourceRaw === 'sync'
      ? sourceRaw
      : 'sync';
  return {
    id: str(row.id),
    loadUuid: row.load_uuid ? str(row.load_uuid) : null,
    broker: str(row.broker, 'Amazon'),
    trip: str(row.trip),
    loadIds: str(row.load_ids),
    driverName: str(row.driver_name),
    pickupDate: row.pickup_date ? str(row.pickup_date) : null,
    deliveryDate: row.delivery_date ? str(row.delivery_date) : null,
    puLocation: sanitizeReportLocation(str(row.pu_location)),
    delLocation: sanitizeReportLocation(str(row.del_location)),
    mile: str(row.mile),
    amazonPaid: num(row.amazon_paid),
    driverPaid: num(row.driver_paid),
    rpm: num(row.rpm),
    comment: str(row.comment),
    dispatch: str(row.dispatch),
    source,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export function loadReportToRow(report: Partial<LoadReport> & { id?: string }): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (report.id != null) row.id = report.id;
  if (report.loadUuid !== undefined) row.load_uuid = report.loadUuid;
  if (report.broker != null) row.broker = report.broker;
  if (report.trip != null) row.trip = report.trip;
  if (report.loadIds != null) row.load_ids = report.loadIds;
  if (report.driverName != null) row.driver_name = report.driverName;
  if (report.pickupDate !== undefined) row.pickup_date = report.pickupDate;
  if (report.deliveryDate !== undefined) row.delivery_date = report.deliveryDate;
  if (report.puLocation != null) row.pu_location = report.puLocation;
  if (report.delLocation != null) row.del_location = report.delLocation;
  if (report.mile != null) row.mile = report.mile;
  if (report.amazonPaid != null) row.amazon_paid = report.amazonPaid;
  if (report.driverPaid != null) row.driver_paid = report.driverPaid;
  if (report.rpm != null) row.rpm = report.rpm;
  if (report.comment != null) row.comment = report.comment;
  if (report.dispatch != null) row.dispatch = report.dispatch;
  if (report.source != null) row.source = report.source;
  if (report.createdAt != null) row.created_at = report.createdAt;
  if (report.updatedAt != null) row.updated_at = report.updatedAt;
  return row;
}
