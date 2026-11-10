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

export interface Load {
  id: string;
  loadId: string;
  amazonRefId: string;
  driverId: string | null;
  loadStatus: LoadStatus;
  paymentStatus: PaymentStatus;
  pickupLocation: string;
  deliveryLocation: string;
  pickupDate: string;
  deliveryDate: string;
  trailerId: string;
  trailerType: TrailerType;
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
