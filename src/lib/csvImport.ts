/** Lightweight CSV parse + helpers for driver / fee / charge imports. */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell.trim());
      cell = '';
      if (row.some((c) => c.length)) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c.length)) rows.push(row);
  return rows;
}

export function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? '';
    });
    return obj;
  });
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

export type ImportedDriver = {
  driverId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  status: string;
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
};

/** Headers: driver_id, first_name, last_name, phone, email, status, truck/tractor, trailer_id, hire_date, ... */
export function mapDriverCsvRow(row: Record<string, string>, index: number): ImportedDriver | null {
  const firstName =
    pick(row, ['first_name', 'firstname', 'first']) ||
    pick(row, ['name', 'driver_name', 'driver']).split(/\s+/)[0] ||
    '';
  const lastFromName = pick(row, ['name', 'driver_name', 'driver']).split(/\s+/).slice(1).join(' ');
  const lastName = pick(row, ['last_name', 'lastname', 'last']) || lastFromName;
  if (!firstName || !lastName) return null;
  const today = new Date().toISOString().slice(0, 10);
  return {
    driverId: pick(row, ['driver_id', 'id', 'employee_id']) || `DRV-${1000 + index}`,
    firstName,
    lastName,
    phone: pick(row, ['phone', 'mobile', 'cell']),
    email: pick(row, ['email', 'e-mail']),
    status: pick(row, ['status']) || 'Available',
    assignedTruck: pick(row, ['assigned_truck', 'truck', 'tractor', 'tractor_id']),
    trailerId: pick(row, ['trailer_id', 'trailer']),
    hireDate: pick(row, ['hire_date', 'start_date']) || today,
    notes: pick(row, ['notes', 'note']),
    address: pick(row, ['address', 'street']),
    city: pick(row, ['city']),
    state: pick(row, ['state']),
    zip: pick(row, ['zip', 'zipcode', 'postal']),
    licenseNumber: pick(row, ['license_number', 'license', 'cdl']),
    licenseExpiry: pick(row, ['license_expiry', 'license_exp']) || '2030-01-01',
  };
}

export type ImportedFee = {
  driverKey: string;
  feeName: string;
  category: string;
  calculationType: 'Fixed' | 'Percentage';
  amount: number;
  frequency: string;
  active: boolean;
  startDate: string;
  endDate: string | null;
  description: string;
};

/** Percentages / recurring fees: driver_id|driver_name, fee_name, percent|amount, frequency, category */
export function mapFeeCsvRow(row: Record<string, string>): ImportedFee | null {
  const driverKey = pick(row, ['driver_id', 'driver', 'driver_name', 'name']);
  if (!driverKey) return null;
  const percent = pick(row, ['percent', 'percentage', 'pct', 'dispatch_percent', 'driver_percent']);
  const amountRaw = pick(row, ['amount', 'rate', 'value']);
  const isPct =
    percent !== '' ||
    /percent/i.test(pick(row, ['calculation_type', 'type', 'calc_type'])) ||
    /%/.test(amountRaw);
  const amount = Number(String(percent || amountRaw).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(amount)) return null;
  const today = new Date().toISOString().slice(0, 10);
  return {
    driverKey,
    feeName: pick(row, ['fee_name', 'name', 'fee']) || (isPct ? 'Driver percentage' : 'Weekly fee'),
    category: pick(row, ['category']) || 'Dispatch',
    calculationType: isPct ? 'Percentage' : 'Fixed',
    amount,
    frequency: pick(row, ['frequency']) || 'Weekly',
    active: !/false|0|no|inactive/i.test(pick(row, ['active', 'enabled']) || 'true'),
    startDate: pick(row, ['start_date']) || today,
    endDate: pick(row, ['end_date']) || null,
    description: pick(row, ['description', 'notes', 'note']),
  };
}

export type ImportedCharge = {
  driverKey: string;
  description: string;
  amount: number;
  date: string;
  settlementWeekStart: string;
  category: string;
  notes: string;
};

/** Weekly one-time charges: driver_id|name, description, amount, date, week_start, category */
export function mapChargeCsvRow(row: Record<string, string>): ImportedCharge | null {
  const driverKey = pick(row, ['driver_id', 'driver', 'driver_name', 'name']);
  const description = pick(row, ['description', 'charge', 'fee_name', 'name']);
  const amount = Number(String(pick(row, ['amount', 'charge_amount', 'value'])).replace(/[^0-9.-]/g, ''));
  if (!driverKey || !description || !Number.isFinite(amount)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const date = pick(row, ['date', 'charge_date']) || today;
  return {
    driverKey,
    description,
    amount,
    date,
    settlementWeekStart: pick(row, ['settlement_week_start', 'week_start', 'week']) || date,
    category: pick(row, ['category']) || 'Other',
    notes: pick(row, ['notes', 'note']),
  };
}
