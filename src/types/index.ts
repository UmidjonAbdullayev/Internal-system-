export type DriverStatus =
  | 'Active'
  | 'Inactive'
  | 'On Load'
  | 'Available'
  | 'On Break'
  | 'Suspended';

export type LoadStatus =
  | 'Available'
  | 'Booked'
  | 'Dispatched'
  | 'In Transit'
  | 'Delivered'
  | 'Completed'
  | 'Cancelled'
  | 'Rejected';

export type PaymentStatus =
  | 'Not Received'
  | 'Pending'
  | 'Processing'
  | 'Paid'
  | 'On Hold'
  | 'Disputed';

export type SettlementStatus =
  | 'Draft'
  | 'Under Review'
  | 'Approved'
  | 'Processing'
  | 'Paid'
  | 'On Hold'
  | 'Partially Paid';

export type FeeCalculationType = 'Fixed' | 'Percentage';
export type FeeFrequency = 'Per Load' | 'Daily' | 'Weekly' | 'Monthly';
export type ChargeCategory =
  | 'Fuel'
  | 'Dispatch'
  | 'Insurance'
  | 'Equipment'
  | 'ELD'
  | 'Trailer'
  | 'Damage'
  | 'Other';

export type TrailerType = 'Dry Van' | 'Reefer' | 'Flatbed' | 'Step Deck' | 'Box Truck';

export interface Driver {
  id: string;
  driverId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  status: DriverStatus;
  assignedTruck: string;
  trailerId: string;
  hireDate: string;
  notes: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  licenseNumber: string;
  licenseExpiry: string;
  createdAt: string;
  updatedAt: string;
}

export type TripBucket = 'upcoming' | 'in_transit' | 'history';

export type RelaySection = 'IN_TRANSIT' | 'UPCOMING' | 'HISTORY';

export type StatusBarState =
  | 'pending'
  | 'arrived'
  | 'loaded_enroute'
  | 'completed'
  | 'cancelled'
  | string;

/** Cost / toll line from Relay tour aggregatedCostItems (stored on trip.raw). */
export interface RelayCostItem {
  name: string;
  amount: number | null;
}

export interface RelayStop {
  id: string;
  stopId: string;
  loadId: string;
  tripId: string;
  seq: number | null;
  stopType: string | null;
  facilityCode: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  timeZone: string | null;
  scheduledArrival: string | null;
  actualArrival: string | null;
  scheduledDeparture: string | null;
  actualDeparture: string | null;
  eta: string | null;
  scheduledArrivalLocal: string | null;
  actualArrivalLocal: string | null;
  raw: Record<string, unknown>;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RelayLeg {
  id: string;
  loadId: string;
  tripId: string;
  facilitySequence: string | null;
  executionStatus: string | null;
  equipmentType: string | null;
  miles: number | null;
  payout: number | null;
  tractorId: string | null;
  trailerId: string | null;
  driverNameRaw: string | null;
  cpt: string | null;
  contentHash: string | null;
  raw: Record<string, unknown>;
  archived: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  stops: RelayStop[];
}

export interface RelayTrip {
  id: string;
  tripId: string;
  section: RelaySection | null;
  relayVersion: string | null;
  lastSeenAt: string | null;
  tourState: string | null;
  executionStatus: string | null;
  workType: string | null;
  businessType: string | null;
  startTime: string | null;
  endTime: string | null;
  totalMiles: number | null;
  payout: number | null;
  currency: string | null;
  ratePerMile: number | null;
  driverNameRaw: string | null;
  equipment: string | null;
  status: string | null;
  contentHash: string | null;
  raw: Record<string, unknown>;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  legs: RelayLeg[];
  costItems: RelayCostItem[];
}

export interface RelaySectionSnapshot {
  section: RelaySection;
  tripIds: string[];
  totalRecords: number;
  crmCount: number;
  mismatch: boolean;
  syncedAt: string;
  updatedAt: string;
}

export type RelaySyncHealthStatus = 'healthy' | 'paused' | 'unknown';

export interface RelaySyncHealth {
  status: RelaySyncHealthStatus;
  lastSyncedAt: string | null;
  detail: string | null;
}

export interface Load {
  id: string;
  loadId: string;
  amazonRefId: string;
  driverId: string | null;
  driverNameRaw?: string;
  loadStatus: LoadStatus;
  paymentStatus: PaymentStatus;
  pickupLocation: string;
  deliveryLocation: string;
  pickupDate: string;
  deliveryDate: string;
  trailerId: string;
  trailerType: TrailerType;
  tractorId?: string;
  parentTripId?: string | null;
  tripBucket?: TripBucket | null;
  statusBarState?: StatusBarState | null;
  statusStopIndex?: number | null;
  arrivalActual?: string | null;
  arrivalScheduled?: string | null;
  arrivalAddress?: string | null;
  jobType?: string | null;
  distanceMiles: number;
  rateGross: number;
  additionalCharges: number;
  paymentDate: string | null;
  notes: string;
  statusHistory: StatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface StatusHistoryEntry {
  status: LoadStatus;
  timestamp: string;
  note?: string;
}

export interface DriverFee {
  id: string;
  driverId: string;
  feeName: string;
  category: ChargeCategory;
  calculationType: FeeCalculationType;
  amount: number;
  frequency: FeeFrequency;
  active: boolean;
  startDate: string;
  endDate: string | null;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface OneTimeCharge {
  id: string;
  driverId: string;
  description: string;
  amount: number;
  date: string;
  settlementWeekStart: string;
  category: ChargeCategory;
  notes: string;
  createdAt: string;
}

export interface SettlementChargeSnapshot {
  id: string;
  chargeName: string;
  category: ChargeCategory;
  calculationType: FeeCalculationType;
  originalAmountOrRate: number;
  appliedAmount: number;
  frequency: FeeFrequency | 'One-Time';
  chargeType: 'Recurring' | 'One-Time' | 'Adjustment';
  sourceId: string;
}

export interface SettlementPayment {
  id: string;
  date: string;
  method: string;
  referenceId: string;
  amount: number;
  notes: string;
}

/** Row from public.payments (Amazon Relay sync + settlement payments). */
export interface RelayPayment {
  id: string;
  settlementId: string | null;
  loadId: string | null;
  paymentDate: string;
  method: string;
  referenceId: string;
  amount: number;
  notes: string;
  amazonRefId: string;
  source: string;
  createdAt: string;
  lastSynchronized: string | null;
}

export interface SettlementAdjustment {
  id: string;
  description: string;
  amount: number;
  date: string;
  createdBy: string;
}

export interface Settlement {
  id: string;
  driverId: string;
  weekStart: string;
  weekEnd: string;
  weeklyGross: number;
  totalDeductions: number;
  netPayable: number;
  amountPaid: number;
  status: SettlementStatus;
  paymentDate: string | null;
  charges: SettlementChargeSnapshot[];
  loadIds: string[];
  payments: SettlementPayment[];
  adjustments: SettlementAdjustment[];
  finalized: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLog {
  id: string;
  type: 'load' | 'driver' | 'payment' | 'charge' | 'settlement' | 'system';
  action: string;
  description: string;
  entityId?: string;
  timestamp: string;
  user: string;
}

export interface GrossAdjustment {
  id: string;
  driverId: string;
  amount: number;
  reason: string;
  date: string;
  createdAt: string;
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: 'Owner' | 'Dispatcher' | 'Fleet Manager' | 'Accounting';
  companyName: string;
}

export interface DateRange {
  start: string;
  end: string;
}

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'custom';

/** Spreadsheet row for Reports tab (persisted ops sheet). */
export interface LoadReport {
  id: string;
  loadUuid: string | null;
  broker: string;
  trip: string;
  loadIds: string;
  driverName: string;
  pickupDate: string | null;
  deliveryDate: string | null;
  puLocation: string;
  delLocation: string;
  mile: string;
  amazonPaid: number;
  driverPaid: number;
  rpm: number;
  comment: string;
  dispatch: string;
  source: 'sync' | 'auto' | 'manual';
  createdAt: string;
  updatedAt: string;
}
