import { format, subDays, addDays, startOfWeek, parseISO } from 'date-fns';
import type {
  Driver,
  Load,
  DriverFee,
  OneTimeCharge,
  Settlement,
  ActivityLog,
  GrossAdjustment,
  AppUser,
  LoadStatus,
  PaymentStatus,
  TrailerType,
  SettlementChargeSnapshot,
} from '@/types';
import {
  getLoadFinalGross,
  buildChargeSnapshots,
  calculateSettlementTotals,
  isEligibleLoad,
} from '@/lib/calculations';
import { roundMoney, getWeekRange } from '@/lib/utils';

const TODAY = new Date('2026-11-10T12:00:00');

function d(offset: number): string {
  return format(addDays(TODAY, offset), 'yyyy-MM-dd');
}

function iso(offset: number, hour = 10): string {
  const date = addDays(TODAY, offset);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

export const currentUser: AppUser = {
  id: 'user-1',
  name: 'Sarah Mitchell',
  email: 'sarah@apexfreight.com',
  role: 'Owner',
  companyName: 'Apex Freight Logistics',
};

const DRIVER_SEED: Omit<Driver, 'createdAt' | 'updatedAt'>[] = [
  { id: 'drv-1', driverId: 'DRV-1024', firstName: 'Michael', lastName: 'Anderson', phone: '(214) 555-0142', email: 'manderson@email.com', status: 'On Load', assignedTruck: 'TRK-2201', trailerId: 'TR-4521', hireDate: '2023-03-15', notes: 'Preferred Southwest lanes', address: '1842 Oak Ridge Dr', city: 'Dallas', state: 'TX', zip: '75201', licenseNumber: 'TX-D-884210', licenseExpiry: '2027-06-30' },
  { id: 'drv-2', driverId: 'DRV-1025', firstName: 'Robert', lastName: 'Williams', phone: '(312) 555-0198', email: 'rwilliams@email.com', status: 'Available', assignedTruck: 'TRK-2202', trailerId: 'TR-4522', hireDate: '2022-11-01', notes: 'Midwest specialist', address: '920 N Michigan Ave', city: 'Chicago', state: 'IL', zip: '60611', licenseNumber: 'IL-CDL-55201', licenseExpiry: '2026-12-15' },
  { id: 'drv-3', driverId: 'DRV-1026', firstName: 'David', lastName: 'Johnson', phone: '(404) 555-0167', email: 'djohnson@email.com', status: 'On Load', assignedTruck: 'TRK-2203', trailerId: 'TR-4523', hireDate: '2023-07-20', notes: '', address: '455 Peachtree St', city: 'Atlanta', state: 'GA', zip: '30308', licenseNumber: 'GA-CDL-99102', licenseExpiry: '2028-01-20' },
  { id: 'drv-4', driverId: 'DRV-1027', firstName: 'James', lastName: 'Thompson', phone: '(615) 555-0133', email: 'jthompson@email.com', status: 'Active', assignedTruck: 'TRK-2204', trailerId: 'TR-7821', hireDate: '2024-01-10', notes: 'Team lead candidate', address: '210 Music Row', city: 'Nashville', state: 'TN', zip: '37203', licenseNumber: 'TN-CDL-44110', licenseExpiry: '2027-09-01' },
  { id: 'drv-5', driverId: 'DRV-1028', firstName: 'Christopher', lastName: 'Davis', phone: '(213) 555-0188', email: 'cdavis@email.com', status: 'On Load', assignedTruck: 'TRK-2205', trailerId: 'TR-9012', hireDate: '2022-05-05', notes: 'West Coast lanes', address: '7700 Sunset Blvd', city: 'Los Angeles', state: 'CA', zip: '90046', licenseNumber: 'CA-A-778201', licenseExpiry: '2026-11-30' },
  { id: 'drv-6', driverId: 'DRV-1029', firstName: 'Daniel', lastName: 'Martinez', phone: '(602) 555-0144', email: 'dmartinez@email.com', status: 'Available', assignedTruck: 'TRK-2206', trailerId: 'TR-4524', hireDate: '2023-09-12', notes: '', address: '3400 E Camelback Rd', city: 'Phoenix', state: 'AZ', zip: '85018', licenseNumber: 'AZ-CDL-22019', licenseExpiry: '2027-04-15' },
  { id: 'drv-7', driverId: 'DRV-1030', firstName: 'William', lastName: 'Brown', phone: '(973) 555-0171', email: 'wbrown@email.com', status: 'On Break', assignedTruck: 'TRK-2207', trailerId: 'TR-7822', hireDate: '2021-08-22', notes: 'Northeast corridor', address: '88 Broad St', city: 'Newark', state: 'NJ', zip: '07102', licenseNumber: 'NJ-CDL-33021', licenseExpiry: '2026-08-10' },
  { id: 'drv-8', driverId: 'DRV-1031', firstName: 'Joseph', lastName: 'Wilson', phone: '(410) 555-0155', email: 'jwilson@email.com', status: 'Active', assignedTruck: 'TRK-2208', trailerId: 'TR-9013', hireDate: '2024-03-01', notes: '', address: '1500 W Pratt St', city: 'Baltimore', state: 'MD', zip: '21223', licenseNumber: 'MD-CDL-88012', licenseExpiry: '2028-03-01' },
  { id: 'drv-9', driverId: 'DRV-1032', firstName: 'Thomas', lastName: 'Garcia', phone: '(713) 555-0190', email: 'tgarcia@email.com', status: 'On Load', assignedTruck: 'TRK-2209', trailerId: 'TR-4525', hireDate: '2023-01-18', notes: 'Gulf Coast routes', address: '1200 Main St', city: 'Houston', state: 'TX', zip: '77002', licenseNumber: 'TX-D-991033', licenseExpiry: '2027-11-01' },
  { id: 'drv-10', driverId: 'DRV-1033', firstName: 'Charles', lastName: 'Rodriguez', phone: '(305) 555-0122', email: 'crodriguez@email.com', status: 'Available', assignedTruck: 'TRK-2210', trailerId: 'TR-7823', hireDate: '2022-12-05', notes: '', address: '800 Biscayne Blvd', city: 'Miami', state: 'FL', zip: '33132', licenseNumber: 'FL-CDL-55021', licenseExpiry: '2026-10-20' },
  { id: 'drv-11', driverId: 'DRV-1034', firstName: 'Matthew', lastName: 'Lee', phone: '(704) 555-0166', email: 'mlee@email.com', status: 'Active', assignedTruck: 'TRK-2211', trailerId: 'TR-9014', hireDate: '2024-06-15', notes: 'New hire — mentoring with Anderson', address: '301 S Tryon St', city: 'Charlotte', state: 'NC', zip: '28202', licenseNumber: 'NC-CDL-12044', licenseExpiry: '2028-06-15' },
  { id: 'drv-12', driverId: 'DRV-1035', firstName: 'Anthony', lastName: 'Walker', phone: '(317) 555-0177', email: 'awalker@email.com', status: 'On Load', assignedTruck: 'TRK-2212', trailerId: 'TR-4526', hireDate: '2023-04-28', notes: '', address: '100 W Washington St', city: 'Indianapolis', state: 'IN', zip: '46204', licenseNumber: 'IN-CDL-99011', licenseExpiry: '2027-02-28' },
  { id: 'drv-13', driverId: 'DRV-1036', firstName: 'Mark', lastName: 'Hall', phone: '(816) 555-0134', email: 'mhall@email.com', status: 'Suspended', assignedTruck: 'TRK-2213', trailerId: '', hireDate: '2021-02-14', notes: 'DOT compliance review — pending docs', address: '400 Grand Blvd', city: 'Kansas City', state: 'MO', zip: '64106', licenseNumber: 'MO-CDL-44109', licenseExpiry: '2026-05-01' },
  { id: 'drv-14', driverId: 'DRV-1037', firstName: 'Steven', lastName: 'Allen', phone: '(503) 555-0181', email: 'sallen@email.com', status: 'Available', assignedTruck: 'TRK-2214', trailerId: 'TR-7824', hireDate: '2023-11-08', notes: 'Pacific Northwest', address: '121 SW Morrison St', city: 'Portland', state: 'OR', zip: '97204', licenseNumber: 'OR-CDL-33088', licenseExpiry: '2027-08-22' },
  { id: 'drv-15', driverId: 'DRV-1038', firstName: 'Paul', lastName: 'Young', phone: '(206) 555-0149', email: 'pyoung@email.com', status: 'Inactive', assignedTruck: '', trailerId: '', hireDate: '2020-06-01', notes: 'Seasonal — returns spring 2027', address: '600 4th Ave', city: 'Seattle', state: 'WA', zip: '98104', licenseNumber: 'WA-CDL-22077', licenseExpiry: '2026-06-01' },
  { id: 'drv-16', driverId: 'DRV-1039', firstName: 'Kevin', lastName: 'King', phone: '(901) 555-0158', email: 'kking@email.com', status: 'On Load', assignedTruck: 'TRK-2215', trailerId: 'TR-9015', hireDate: '2024-02-20', notes: '', address: '50 N Front St', city: 'Memphis', state: 'TN', zip: '38103', licenseNumber: 'TN-CDL-77102', licenseExpiry: '2028-02-20' },
];

export const drivers: Driver[] = DRIVER_SEED.map((d) => ({
  ...d,
  createdAt: iso(-120),
  updatedAt: iso(-1),
}));

export const driverFees: DriverFee[] = [
  // Michael Anderson
  { id: 'fee-1', driverId: 'drv-1', feeName: 'Fuel Card', category: 'Fuel', calculationType: 'Fixed', amount: 150, frequency: 'Weekly', active: true, startDate: '2025-01-01', endDate: null, description: 'Weekly fuel card deduction', createdAt: iso(-100), updatedAt: iso(-100) },
  { id: 'fee-2', driverId: 'drv-1', feeName: 'Dispatch Fee', category: 'Dispatch', calculationType: 'Percentage', amount: 10, frequency: 'Weekly', active: true, startDate: '2025-01-01', endDate: null, description: '10% of weekly gross', createdAt: iso(-100), updatedAt: iso(-100) },
  { id: 'fee-3', driverId: 'drv-1', feeName: 'Insurance', category: 'Insurance', calculationType: 'Fixed', amount: 75, frequency: 'Weekly', active: true, startDate: '2025-01-01', endDate: null, description: 'Occupational accident insurance', createdAt: iso(-100), updatedAt: iso(-100) },
  { id: 'fee-4', driverId: 'drv-1', feeName: 'Trailer Rental', category: 'Trailer', calculationType: 'Fixed', amount: 100, frequency: 'Weekly', active: true, startDate: '2025-01-01', endDate: null, description: 'Company trailer rental', createdAt: iso(-100), updatedAt: iso(-100) },
  { id: 'fee-5', driverId: 'drv-1', feeName: 'ELD Fee', category: 'ELD', calculationType: 'Fixed', amount: 25, frequency: 'Weekly', active: true, startDate: '2025-01-01', endDate: null, description: 'ELD device subscription', createdAt: iso(-100), updatedAt: iso(-100) },
  // Robert Williams
  { id: 'fee-6', driverId: 'drv-2', feeName: 'Fuel Card', category: 'Fuel', calculationType: 'Fixed', amount: 200, frequency: 'Weekly', active: true, startDate: '2025-01-01', endDate: null, description: 'Weekly fuel card deduction', createdAt: iso(-100), updatedAt: iso(-100) },
  { id: 'fee-7', driverId: 'drv-2', feeName: 'Dispatch Fee', category: 'Dispatch', calculationType: 'Percentage', amount: 8, frequency: 'Weekly', active: true, startDate: '2025-01-01', endDate: null, description: '8% of weekly gross', createdAt: iso(-100), updatedAt: iso(-100) },
  { id: 'fee-8', driverId: 'drv-2', feeName: 'Insurance', category: 'Insurance', calculationType: 'Fixed', amount: 50, frequency: 'Weekly', active: true, startDate: '2025-01-01', endDate: null, description: 'Occupational accident insurance', createdAt: iso(-100), updatedAt: iso(-100) },
  { id: 'fee-9', driverId: 'drv-2', feeName: 'ELD Fee', category: 'ELD', calculationType: 'Fixed', amount: 25, frequency: 'Weekly', active: true, startDate: '2025-01-01', endDate: null, description: 'ELD device subscription', createdAt: iso(-100), updatedAt: iso(-100) },
  // David Johnson
  { id: 'fee-10', driverId: 'drv-3', feeName: 'Fuel Card', category: 'Fuel', calculationType: 'Fixed', amount: 100, frequency: 'Weekly', active: true, startDate: '2025-01-01', endDate: null, description: 'Weekly fuel card deduction', createdAt: iso(-100), updatedAt: iso(-100) },
  { id: 'fee-11', driverId: 'drv-3', feeName: 'Dispatch Fee', category: 'Dispatch', calculationType: 'Percentage', amount: 12, frequency: 'Weekly', active: true, startDate: '2025-01-01', endDate: null, description: '12% of weekly gross', createdAt: iso(-100), updatedAt: iso(-100) },
  { id: 'fee-12', driverId: 'drv-3', feeName: 'Insurance', category: 'Insurance', calculationType: 'Fixed', amount: 80, frequency: 'Weekly', active: true, startDate: '2025-01-01', endDate: null, description: 'Occupational accident insurance', createdAt: iso(-100), updatedAt: iso(-100) },
  { id: 'fee-13', driverId: 'drv-3', feeName: 'Trailer Rental', category: 'Trailer', calculationType: 'Fixed', amount: 120, frequency: 'Weekly', active: true, startDate: '2025-01-01', endDate: null, description: 'Company trailer rental', createdAt: iso(-100), updatedAt: iso(-100) },
  // Remaining drivers — standard package
  ...(['drv-4', 'drv-5', 'drv-6', 'drv-7', 'drv-8', 'drv-9', 'drv-10', 'drv-11', 'drv-12', 'drv-14', 'drv-16'] as const).flatMap((driverId, i) => [
    { id: `fee-std-${i}-fuel`, driverId, feeName: 'Fuel Card', category: 'Fuel' as const, calculationType: 'Fixed' as const, amount: 125 + (i % 3) * 25, frequency: 'Weekly' as const, active: true, startDate: '2025-01-01', endDate: null, description: 'Weekly fuel card deduction', createdAt: iso(-90), updatedAt: iso(-90) },
    { id: `fee-std-${i}-disp`, driverId, feeName: 'Dispatch Fee', category: 'Dispatch' as const, calculationType: 'Percentage' as const, amount: 9 + (i % 3), frequency: 'Weekly' as const, active: true, startDate: '2025-01-01', endDate: null, description: 'Dispatch percentage of gross', createdAt: iso(-90), updatedAt: iso(-90) },
    { id: `fee-std-${i}-ins`, driverId, feeName: 'Insurance', category: 'Insurance' as const, calculationType: 'Fixed' as const, amount: 60 + (i % 4) * 10, frequency: 'Weekly' as const, active: true, startDate: '2025-01-01', endDate: null, description: 'Occupational accident insurance', createdAt: iso(-90), updatedAt: iso(-90) },
    { id: `fee-std-${i}-eld`, driverId, feeName: 'ELD Fee', category: 'ELD' as const, calculationType: 'Fixed' as const, amount: 25, frequency: 'Weekly' as const, active: true, startDate: '2025-01-01', endDate: null, description: 'ELD device subscription', createdAt: iso(-90), updatedAt: iso(-90) },
  ]),
];

const ROUTES: { pickup: string; delivery: string; miles: number; baseRate: number }[] = [
  { pickup: 'Dallas, TX', delivery: 'Houston, TX', miles: 239, baseRate: 850 },
  { pickup: 'Chicago, IL', delivery: 'Indianapolis, IN', miles: 183, baseRate: 720 },
  { pickup: 'Atlanta, GA', delivery: 'Nashville, TN', miles: 249, baseRate: 890 },
  { pickup: 'Los Angeles, CA', delivery: 'Phoenix, AZ', miles: 372, baseRate: 1250 },
  { pickup: 'Newark, NJ', delivery: 'Baltimore, MD', miles: 185, baseRate: 780 },
  { pickup: 'Houston, TX', delivery: 'Memphis, TN', miles: 565, baseRate: 1680 },
  { pickup: 'Phoenix, AZ', delivery: 'Dallas, TX', miles: 887, baseRate: 2450 },
  { pickup: 'Nashville, TN', delivery: 'Charlotte, NC', miles: 410, baseRate: 1320 },
  { pickup: 'Miami, FL', delivery: 'Atlanta, GA', miles: 662, baseRate: 1890 },
  { pickup: 'Seattle, WA', delivery: 'Portland, OR', miles: 174, baseRate: 650 },
  { pickup: 'Kansas City, MO', delivery: 'Chicago, IL', miles: 510, baseRate: 1550 },
  { pickup: 'Baltimore, MD', delivery: 'Newark, NJ', miles: 185, baseRate: 760 },
  { pickup: 'Indianapolis, IN', delivery: 'Atlanta, GA', miles: 533, baseRate: 1600 },
  { pickup: 'Memphis, TN', delivery: 'Dallas, TX', miles: 452, baseRate: 1400 },
  { pickup: 'Charlotte, NC', delivery: 'Baltimore, MD', miles: 400, baseRate: 1280 },
  { pickup: 'Portland, OR', delivery: 'Los Angeles, CA', miles: 962, baseRate: 2700 },
  { pickup: 'Dallas, TX', delivery: 'Phoenix, AZ', miles: 887, baseRate: 2400 },
  { pickup: 'Atlanta, GA', delivery: 'Miami, FL', miles: 662, baseRate: 1850 },
  { pickup: 'Chicago, IL', delivery: 'Kansas City, MO', miles: 510, baseRate: 1520 },
  { pickup: 'Houston, TX', delivery: 'Atlanta, GA', miles: 793, baseRate: 2100 },
];

const TRAILERS = ['TR-4521', 'TR-4522', 'TR-4523', 'TR-4524', 'TR-4525', 'TR-4526', 'TR-7821', 'TR-7822', 'TR-7823', 'TR-7824', 'TR-9012', 'TR-9013', 'TR-9014', 'TR-9015'];
const TRAILER_TYPES: TrailerType[] = ['Dry Van', 'Reefer', 'Dry Van', 'Flatbed', 'Dry Van', 'Reefer', 'Step Deck', 'Dry Van'];
const ACTIVE_DRIVERS = drivers.filter((dr) => !['Inactive', 'Suspended'].includes(dr.status));

const LOAD_STATUSES_WEIGHTED: LoadStatus[] = [
  ...Array(55).fill('Completed'),
  ...Array(12).fill('Delivered'),
  ...Array(10).fill('In Transit'),
  ...Array(8).fill('Dispatched'),
  ...Array(5).fill('Booked'),
  ...Array(4).fill('Available'),
  ...Array(3).fill('Cancelled'),
  ...Array(3).fill('Rejected'),
];

const PAYMENT_BY_STATUS: Record<LoadStatus, PaymentStatus[]> = {
  Completed: ['Paid', 'Paid', 'Paid', 'Pending', 'Processing', 'Paid'],
  Delivered: ['Pending', 'Processing', 'Not Received', 'Pending'],
  'In Transit': ['Not Received', 'Pending'],
  Dispatched: ['Not Received'],
  Booked: ['Not Received'],
  Available: ['Not Received'],
  Cancelled: ['Not Received', 'On Hold'],
  Rejected: ['Not Received', 'Disputed'],
};

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function generateLoads(): Load[] {
  const loads: Load[] = [];
  let loadNum = 8400;

  for (let i = 0; i < 110; i++) {
    const route = pick(ROUTES, i);
    const status = pick(LOAD_STATUSES_WEIGHTED, i);
    const dayOffset = -28 + Math.floor(i * 0.28) + (i % 3); // spread over ~4 weeks
    const transitDays = Math.max(1, Math.round(route.miles / 450));
    const pickupDate = d(Math.min(0, dayOffset));
    const deliveryDate = d(Math.min(0, dayOffset + transitDays));
    const rateVariance = 1 + ((i % 7) - 3) * 0.04;
    const rateGross = roundMoney(route.baseRate * rateVariance);
    const additionalCharges = i % 5 === 0 ? roundMoney(50 + (i % 4) * 25) : i % 8 === 0 ? 75 : 0;
    const driver = ['Available', 'Cancelled', 'Rejected'].includes(status) && i % 4 === 0
      ? null
      : pick(ACTIVE_DRIVERS, i);
    const payments = PAYMENT_BY_STATUS[status];
    const paymentStatus = pick(payments, i);
    const paymentDate =
      paymentStatus === 'Paid' ? d(Math.min(0, dayOffset + transitDays + 2)) : null;

    const statusHistory: Load['statusHistory'] = [
      { status: 'Booked', timestamp: iso(dayOffset - 1, 8), note: 'Booked via Amazon Relay' },
    ];
    if (!['Available', 'Booked'].includes(status)) {
      statusHistory.push({ status: 'Dispatched', timestamp: iso(dayOffset, 6) });
    }
    if (['In Transit', 'Delivered', 'Completed'].includes(status)) {
      statusHistory.push({ status: 'In Transit', timestamp: iso(dayOffset, 10) });
    }
    if (['Delivered', 'Completed'].includes(status)) {
      statusHistory.push({ status: 'Delivered', timestamp: iso(dayOffset + transitDays, 14) });
    }
    if (status === 'Completed') {
      statusHistory.push({ status: 'Completed', timestamp: iso(dayOffset + transitDays, 16), note: 'POD confirmed' });
    }
    if (status === 'Cancelled') {
      statusHistory.push({ status: 'Cancelled', timestamp: iso(dayOffset, 12), note: 'Shipper cancelled' });
    }
    if (status === 'Rejected') {
      statusHistory.push({ status: 'Rejected', timestamp: iso(dayOffset - 1, 11), note: 'Rate rejected' });
    }

    loadNum++;
    loads.push({
      id: `load-${i + 1}`,
      loadId: `LD-${loadNum}`,
      amazonRefId: `AMZ-R${String(920000 + i).padStart(7, '0')}`,
      driverId: driver?.id ?? null,
      loadStatus: status,
      paymentStatus,
      pickupLocation: route.pickup,
      deliveryLocation: route.delivery,
      pickupDate,
      deliveryDate,
      trailerId: status === 'Available' && i % 3 === 0 ? '' : pick(TRAILERS, i),
      trailerType: pick(TRAILER_TYPES, i),
      distanceMiles: route.miles + (i % 5) * 3,
      rateGross,
      additionalCharges,
      paymentDate,
      notes: i % 11 === 0 ? 'Detention possible — warehouse delay' : i % 17 === 0 ? 'Team driver preferred' : '',
      statusHistory,
      createdAt: iso(dayOffset - 2),
      updatedAt: iso(Math.min(0, dayOffset + transitDays)),
    });
  }
  return loads;
}

export const loads: Load[] = generateLoads();

// One-time charges for current and previous weeks
const thisWeek = getWeekRange(TODAY);
const lastWeek = getWeekRange(subDays(TODAY, 7));
const twoWeeksAgo = getWeekRange(subDays(TODAY, 14));
const threeWeeksAgo = getWeekRange(subDays(TODAY, 21));

export const oneTimeCharges: OneTimeCharge[] = [
  { id: 'otc-1', driverId: 'drv-1', description: 'Fuel Card Replacement', amount: 80, date: thisWeek.start, settlementWeekStart: thisWeek.start, category: 'Fuel', notes: 'Lost card replacement fee', createdAt: iso(-2) },
  { id: 'otc-2', driverId: 'drv-1', description: 'Equipment Charge', amount: 45, date: thisWeek.start, settlementWeekStart: thisWeek.start, category: 'Equipment', notes: 'Straps and binders', createdAt: iso(-2) },
  { id: 'otc-3', driverId: 'drv-2', description: 'Tire Damage', amount: 120, date: lastWeek.start, settlementWeekStart: lastWeek.start, category: 'Damage', notes: 'Curb damage — repair', createdAt: iso(-9) },
  { id: 'otc-4', driverId: 'drv-3', description: 'Parking Violation', amount: 65, date: thisWeek.start, settlementWeekStart: thisWeek.start, category: 'Other', notes: 'Atlanta downtown', createdAt: iso(-1) },
  { id: 'otc-5', driverId: 'drv-5', description: 'Additional Equipment', amount: 45, date: lastWeek.start, settlementWeekStart: lastWeek.start, category: 'Equipment', notes: '', createdAt: iso(-8) },
  { id: 'otc-6', driverId: 'drv-7', description: 'Uniform Deduction', amount: 35, date: twoWeeksAgo.start, settlementWeekStart: twoWeeksAgo.start, category: 'Other', notes: '', createdAt: iso(-16) },
  { id: 'otc-7', driverId: 'drv-9', description: 'Scale Ticket Fee', amount: 25, date: thisWeek.start, settlementWeekStart: thisWeek.start, category: 'Other', notes: '', createdAt: iso(-1) },
  { id: 'otc-8', driverId: 'drv-4', description: 'Trailer Washout', amount: 55, date: lastWeek.start, settlementWeekStart: lastWeek.start, category: 'Trailer', notes: 'Reefer washout', createdAt: iso(-7) },
];

export const grossAdjustments: GrossAdjustment[] = [
  { id: 'ga-1', driverId: 'drv-2', amount: 150, reason: 'Detention pay — Chicago warehouse', date: lastWeek.start, createdAt: iso(-8) },
  { id: 'ga-2', driverId: 'drv-5', amount: -75, reason: 'Claim adjustment — damaged freight credit reverse', date: twoWeeksAgo.start, createdAt: iso(-15) },
];

function buildSettlementForWeek(
  driverId: string,
  weekStart: string,
  status: Settlement['status'],
  amountPaid: number,
  finalized: boolean,
  id: string
): Settlement {
  const weekEnd = format(
    parseISO(getWeekRange(parseISO(weekStart)).end),
    'yyyy-MM-dd'
  );
  const weekLoads = loads.filter(
    (l) =>
      l.driverId === driverId &&
      isEligibleLoad(l) &&
      l.deliveryDate >= weekStart &&
      l.deliveryDate <= weekEnd
  );
  const weeklyGross = roundMoney(
    weekLoads.reduce((s, l) => s + getLoadFinalGross(l), 0) +
      grossAdjustments
        .filter((a) => a.driverId === driverId && a.date >= weekStart && a.date <= weekEnd)
        .reduce((s, a) => s + a.amount, 0)
  );
  const charges: SettlementChargeSnapshot[] = buildChargeSnapshots(
    driverFees,
    oneTimeCharges,
    driverId,
    weekStart,
    weeklyGross,
    weekLoads.length
  );
  const { totalDeductions, netPayable } = calculateSettlementTotals(weeklyGross, charges);
  const payments =
    amountPaid > 0
      ? [
          {
            id: `pay-${id}-1`,
            date: format(addDays(parseISO(weekEnd), 2), 'yyyy-MM-dd'),
            method: amountPaid < netPayable ? 'ACH Partial' : 'ACH Direct Deposit',
            referenceId: `TXN-${id.toUpperCase()}`,
            amount: amountPaid,
            notes: '',
          },
        ]
      : [];

  return {
    id,
    driverId,
    weekStart,
    weekEnd,
    weeklyGross,
    totalDeductions,
    netPayable,
    amountPaid,
    status,
    paymentDate: amountPaid > 0 ? payments[0].date : null,
    charges,
    loadIds: weekLoads.map((l) => l.id),
    payments,
    adjustments: [],
    finalized,
    createdAt: iso(-20),
    updatedAt: iso(-1),
  };
}

const settlementDrivers = ACTIVE_DRIVERS.map((d) => d.id);

export const settlements: Settlement[] = [
  // Three weeks ago — all paid & finalized
  ...settlementDrivers.map((id, i) =>
    buildSettlementForWeek(id, threeWeeksAgo.start, 'Paid', 999999, true, `set-w3-${i}`)
  ).map((s) => ({ ...s, amountPaid: s.netPayable, status: 'Paid' as const })),
  // Two weeks ago — paid & finalized
  ...settlementDrivers.map((id, i) =>
    buildSettlementForWeek(id, twoWeeksAgo.start, 'Paid', 999999, true, `set-w2-${i}`)
  ).map((s) => ({ ...s, amountPaid: s.netPayable, status: 'Paid' as const })),
  // Last week — mix of paid, partially paid, approved
  ...settlementDrivers.map((id, i) => {
    const base = buildSettlementForWeek(id, lastWeek.start, 'Draft', 0, false, `set-w1-${i}`);
    if (i < 6) {
      return { ...base, status: 'Paid' as const, amountPaid: base.netPayable, finalized: true, paymentDate: d(-3) };
    }
    if (i < 9) {
      const partial = roundMoney(base.netPayable * 0.55);
      return {
        ...base,
        status: 'Partially Paid' as const,
        amountPaid: partial,
        finalized: true,
        paymentDate: d(-2),
        payments: [
          {
            id: `pay-partial-${i}`,
            date: d(-2),
            method: 'ACH Partial',
            referenceId: `TXN-PART-${i}`,
            amount: partial,
            notes: 'Partial payment — balance pending',
          },
        ],
      };
    }
    if (i < 12) {
      return { ...base, status: 'Approved' as const, finalized: true };
    }
    return { ...base, status: 'Under Review' as const };
  }),
  // This week — drafts / under review
  ...settlementDrivers.map((id, i) => {
    const base = buildSettlementForWeek(id, thisWeek.start, 'Draft', 0, false, `set-w0-${i}`);
    if (i < 3) return { ...base, status: 'Under Review' as const };
    if (i === 3) return { ...base, status: 'On Hold' as const };
    return base;
  }),
];

export const activityLogs: ActivityLog[] = [
  { id: 'act-1', type: 'load', action: 'completed', description: 'Load LD-8485 marked Completed — Dallas, TX → Houston, TX', entityId: 'load-86', timestamp: iso(0, 9), user: 'Sarah Mitchell' },
  { id: 'act-2', type: 'payment', action: 'paid', description: 'Settlement paid for Robert Williams — week of Nov 2', entityId: 'set-w1-1', timestamp: iso(0, 8), user: 'Sarah Mitchell' },
  { id: 'act-3', type: 'driver', action: 'status', description: 'William Brown status changed to On Break', entityId: 'drv-7', timestamp: iso(-1, 16), user: 'System' },
  { id: 'act-4', type: 'charge', action: 'added', description: 'One-time charge added: Fuel Card Replacement ($80) — Michael Anderson', entityId: 'otc-1', timestamp: iso(-2, 11), user: 'Sarah Mitchell' },
  { id: 'act-5', type: 'load', action: 'dispatched', description: 'Load LD-8505 dispatched to Christopher Davis', entityId: 'load-106', timestamp: iso(-1, 7), user: 'Dispatcher' },
  { id: 'act-6', type: 'load', action: 'created', description: 'New Amazon Relay load AMZ-R9200105 booked', entityId: 'load-106', timestamp: iso(-1, 6), user: 'System' },
  { id: 'act-7', type: 'settlement', action: 'approved', description: 'Settlement approved for James Thompson — week of Nov 2', entityId: 'set-w1-3', timestamp: iso(-2, 14), user: 'Sarah Mitchell' },
  { id: 'act-8', type: 'driver', action: 'assigned', description: 'Trailer TR-9015 assigned to Kevin King', entityId: 'drv-16', timestamp: iso(-3, 10), user: 'Fleet Manager' },
  { id: 'act-9', type: 'payment', action: 'partial', description: 'Partial payment of $4,200 recorded for David Johnson', entityId: 'set-w1-2', timestamp: iso(-2, 15), user: 'Accounting' },
  { id: 'act-10', type: 'load', action: 'completed', description: 'Load LD-8470 completed — Atlanta, GA → Nashville, TN', entityId: 'load-71', timestamp: iso(-2, 17), user: 'System' },
  { id: 'act-11', type: 'charge', action: 'added', description: 'One-time charge: Parking Violation ($65) — David Johnson', entityId: 'otc-4', timestamp: iso(-1, 12), user: 'Sarah Mitchell' },
  { id: 'act-12', type: 'load', action: 'cancelled', description: 'Load cancelled by shipper — Chicago lane', timestamp: iso(-3, 13), user: 'System' },
];

export const companySettings: {
  companyName: string;
  companyAddress: string;
  ein: string;
  weekStartsOn: 0 | 1;
  defaultDispatchFeePercent: number;
  currency: string;
  timezone: string;
} = {
  companyName: 'Apex Freight Logistics',
  companyAddress: '2400 Commerce Street, Suite 400, Dallas, TX 75201',
  ein: '84-2910384',
  weekStartsOn: 1,
  defaultDispatchFeePercent: 10,
  currency: 'USD',
  timezone: 'America/Chicago',
};
