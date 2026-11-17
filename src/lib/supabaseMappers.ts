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
  RelayCostItem,
  RelayLeg,
  RelayPayment,
  RelaySection,
  RelaySectionSnapshot,
  RelayStop,
  RelayTrip,
  Settlement,
  SettlementStatus,
  SyncStateRow,
  TrailerType,
  TripSummary,
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

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function normalizeRelaySection(raw: unknown): RelaySection | null {
  const s = String(raw || '')
    .toUpperCase()
    .replace(/-/g, '_');
  if (s === 'INTRANSIT') return 'IN_TRANSIT';
  if (s === 'IN_TRANSIT' || s === 'UPCOMING' || s === 'HISTORY') return s;
  return null;
}

function extractCostItems(raw: Record<string, unknown>): RelayCostItem[] {
  const fromTop = Array.isArray(raw.costItems) ? raw.costItems : null;
  const fromAgg = Array.isArray(raw.aggregatedCostItems) ? raw.aggregatedCostItems : null;
  const list = fromTop || fromAgg || [];
  return list
    .map((item) => {
      const r = asRecord(item);
      const money = asRecord(r.monetaryAmount);
      const amount =
        r.amount != null
          ? num(r.amount, NaN)
          : money.value != null
            ? num(money.value, NaN)
            : NaN;
      return {
        name: str(r.name, 'Cost'),
        amount: Number.isFinite(amount) ? amount : null,
      };
    })
    .filter((c) => c.name);
}

export function mapRelayStop(row: Record<string, unknown>): RelayStop {
  return {
    id: str(row.id),
    stopId: str(row.stop_id),
    loadId: str(row.load_id),
    tripId: str(row.trip_id),
    seq: row.seq == null ? null : num(row.seq),
    stopType: row.stop_type ? str(row.stop_type) : null,
    facilityCode: row.facility_code ? str(row.facility_code) : null,
    address: row.address ? str(row.address) : null,
    city: row.city ? str(row.city) : null,
    state: row.state ? str(row.state) : null,
    zip: row.zip ? str(row.zip) : null,
    timeZone: row.time_zone ? str(row.time_zone) : null,
    scheduledArrival: row.scheduled_arrival ? str(row.scheduled_arrival) : null,
    actualArrival: row.actual_arrival ? str(row.actual_arrival) : null,
    scheduledDeparture: row.scheduled_departure ? str(row.scheduled_departure) : null,
    actualDeparture: row.actual_departure ? str(row.actual_departure) : null,
    eta: row.eta ? str(row.eta) : null,
    scheduledArrivalLocal: row.scheduled_arrival_local ? str(row.scheduled_arrival_local) : null,
    actualArrivalLocal: row.actual_arrival_local ? str(row.actual_arrival_local) : null,
    raw: asRecord(row.raw),
    archived: Boolean(row.archived),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export function mapRelayLeg(row: Record<string, unknown>, stops: RelayStop[] = []): RelayLeg {
  return {
    id: str(row.id),
    loadId: str(row.load_id),
    tripId: str(row.trip_id),
    facilitySequence: row.facility_sequence ? str(row.facility_sequence) : null,
    executionStatus: row.execution_status ? str(row.execution_status) : null,
    equipmentType: row.equipment_type ? str(row.equipment_type) : null,
    miles: row.miles == null ? null : num(row.miles),
    payout: row.payout == null ? null : num(row.payout),
    tractorId: row.tractor_id ? str(row.tractor_id) : null,
    trailerId: row.trailer_id ? str(row.trailer_id) : null,
    driverNameRaw: row.driver_name_raw ? str(row.driver_name_raw) : null,
    cpt: row.cpt ? str(row.cpt) : null,
    contentHash: row.content_hash ? str(row.content_hash) : null,
    raw: asRecord(row.raw),
    archived: Boolean(row.archived),
    lastSeenAt: row.last_seen_at ? str(row.last_seen_at) : null,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    stops: [...stops].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
  };
}

export function mapRelayTrip(row: Record<string, unknown>, legs: RelayLeg[] = []): RelayTrip {
  const raw = asRecord(row.raw);
  return {
    id: str(row.id),
    tripId: str(row.trip_id),
    section: normalizeRelaySection(row.section),
    relayVersion: row.relay_version ? str(row.relay_version) : null,
    lastSeenAt: row.last_seen_at ? str(row.last_seen_at) : null,
    tourState: row.tour_state ? str(row.tour_state) : null,
    executionStatus: row.execution_status ? str(row.execution_status) : null,
    workType: row.work_type ? str(row.work_type) : null,
    businessType: row.business_type ? str(row.business_type) : null,
    startTime: row.start_time ? str(row.start_time) : null,
    endTime: row.end_time ? str(row.end_time) : null,
    totalMiles: row.total_miles == null ? null : num(row.total_miles),
    payout: row.payout == null ? null : num(row.payout),
    currency: row.currency ? str(row.currency) : null,
    ratePerMile: row.rate_per_mile == null ? null : num(row.rate_per_mile),
    driverNameRaw: row.driver_name_raw ? str(row.driver_name_raw) : null,
    equipment: row.equipment ? str(row.equipment) : null,
    status: row.status ? str(row.status) : null,
    contentHash: row.content_hash ? str(row.content_hash) : null,
    raw,
    archived: Boolean(row.archived),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    legs: [...legs].sort((a, b) => a.loadId.localeCompare(b.loadId)),
    costItems: extractCostItems(raw),
  };
}

export function mapRelaySectionSnapshot(row: Record<string, unknown>): RelaySectionSnapshot | null {
  const section = normalizeRelaySection(row.section);
  if (!section) return null;
  const tripIds = Array.isArray(row.trip_ids)
    ? row.trip_ids.map((id) => str(id)).filter(Boolean)
    : [];
  return {
    section,
    tripIds,
    totalRecords: num(row.total_records),
    crmCount: num(row.crm_count),
    mismatch: Boolean(row.mismatch),
    syncedAt: str(row.synced_at),
    updatedAt: str(row.updated_at),
  };
}

/** Alias used by live-mirrors / retention code paths. */
export function mapSectionSnapshot(row: Record<string, unknown>): RelaySectionSnapshot {
  return (
    mapRelaySectionSnapshot(row) || {
      section: 'HISTORY',
      tripIds: [],
      totalRecords: 0,
      crmCount: 0,
      mismatch: false,
      syncedAt: '',
    }
  );
}

export function mapSyncState(row: Record<string, unknown>): SyncStateRow {
  return {
    section: (normalizeRelaySection(row.section) || 'HISTORY') as RelaySection,
    lastSuccessfulSyncAt: row.last_successful_sync_at ? str(row.last_successful_sync_at) : null,
    lastAttemptAt: row.last_attempt_at ? str(row.last_attempt_at) : null,
    lastError: row.last_error ? str(row.last_error) : null,
    syncing: Boolean(row.syncing),
    updatedAt: str(row.updated_at),
  };
}

export function mapTripSummary(row: Record<string, unknown>): TripSummary {
  return {
    id: str(row.id),
    tripId: str(row.trip_id),
    driverName: row.driver_name ? str(row.driver_name) : null,
    status: row.status ? str(row.status) : null,
    tourState: row.tour_state ? str(row.tour_state) : null,
    executionStatus: row.execution_status ? str(row.execution_status) : null,
    workType: row.work_type ? str(row.work_type) : null,
    businessType: row.business_type ? str(row.business_type) : null,
    equipment: row.equipment ? str(row.equipment) : null,
    startTime: row.start_time ? str(row.start_time) : null,
    endTime: row.end_time ? str(row.end_time) : null,
    totalMiles: row.total_miles == null ? null : num(row.total_miles),
    payout: row.payout == null ? null : num(row.payout),
    currency: row.currency ? str(row.currency) : null,
    ratePerMile: row.rate_per_mile == null ? null : num(row.rate_per_mile),
    facilityCodes: Array.isArray(row.facility_codes) ? row.facility_codes.map((c) => str(c)) : [],
    legLoadIds: Array.isArray(row.leg_load_ids) ? row.leg_load_ids.map((c) => str(c)) : [],
    legCount: num(row.leg_count),
    stopCount: num(row.stop_count),
    wasLate: Boolean(row.was_late),
    lateStopCount: num(row.late_stop_count),
    needsReview: Boolean(row.needs_review),
    removedFromRelay: Boolean(row.removed_from_relay),
    firstSeenAt: row.first_seen_at ? str(row.first_seen_at) : null,
    lastSeenAt: row.last_seen_at ? str(row.last_seen_at) : null,
    summarizedAt: str(row.summarized_at),
  };
}

/** Join trip / leg / stop rows into nested RelayTrip[]. */
export function assembleRelayTrips(
  tripRows: Record<string, unknown>[],
  legRows: Record<string, unknown>[],
  stopRows: Record<string, unknown>[],
): RelayTrip[] {
  const stopsByLoad = new Map<string, RelayStop[]>();
  for (const row of stopRows) {
    const stop = mapRelayStop(row);
    if (stop.archived) continue;
    const list = stopsByLoad.get(stop.loadId) || [];
    list.push(stop);
    stopsByLoad.set(stop.loadId, list);
  }

  const legsByTrip = new Map<string, RelayLeg[]>();
  for (const row of legRows) {
    const loadId = str(row.load_id);
    const leg = mapRelayLeg(row, stopsByLoad.get(loadId) || []);
    if (leg.archived) continue;
    const list = legsByTrip.get(leg.tripId) || [];
    list.push(leg);
    legsByTrip.set(leg.tripId, list);
  }

  return tripRows
    .filter((row) => !row.archived)
    .map((row) => mapRelayTrip(row, legsByTrip.get(str(row.trip_id)) || []))
    .sort((a, b) => {
      const at = a.startTime || a.lastSeenAt || a.updatedAt;
      const bt = b.startTime || b.lastSeenAt || b.updatedAt;
      return bt.localeCompare(at);
    });
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
