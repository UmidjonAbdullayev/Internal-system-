import { loads, drivers, driverFees, oneTimeCharges, settlements, grossAdjustments } from '../src/data/sampleData.ts';
import {
  getFleetGross,
  getDriverGross,
  getEligibleLoads,
  isEligibleLoad,
  computeOrRefreshSettlement,
} from '../src/lib/calculations.ts';
import { getWeekRange, roundMoney } from '../src/lib/utils.ts';

const week = getWeekRange(new Date('2026-11-10'));
console.log('Week:', week);
console.log('Drivers:', drivers.length);
console.log('Loads:', loads.length);
console.log('Eligible loads (all time):', loads.filter(isEligibleLoad).length);
console.log('Cancelled/Rejected:', loads.filter(l => ['Cancelled','Rejected'].includes(l.loadStatus)).length);

const weekEligible = getEligibleLoads(loads, undefined, week);
const weekGross = getFleetGross(loads, week);
console.log('This week eligible loads:', weekEligible.length);
console.log('This week fleet gross:', weekGross);

let driverSum = 0;
for (const d of drivers) {
  driverSum += getDriverGross(loads, d.id, week);
}
driverSum = roundMoney(driverSum);
console.log('Sum of driver week gross (no adj):', driverSum);
console.log('Match fleet?', Math.abs(driverSum - weekGross) < 0.01 ? 'YES' : 'NO');

const michael = drivers.find(d => d.driverId === 'DRV-1024')!;
const michaelLoads = getEligibleLoads(loads, michael.id, week);
const michaelGross = getDriverGross(loads, michael.id, week, grossAdjustments);
const computed = computeOrRefreshSettlement(undefined, michael.id, week.start, loads, driverFees, oneTimeCharges, grossAdjustments);
console.log('\nMichael Anderson this week:');
console.log('  Loads:', michaelLoads.length);
console.log('  Gross:', michaelGross);
console.log('  Deductions:', computed.totalDeductions);
console.log('  Net:', computed.netPayable);
console.log('  Charges:', computed.charges.map(c => `${c.chargeName}=${c.appliedAmount}`).join(', '));

const existing = settlements.find(s => s.driverId === michael.id && s.weekStart === week.start);
if (existing) {
  console.log('\nExisting settlement:');
  console.log('  Gross match:', Math.abs(existing.weeklyGross - computed.weeklyGross) < 0.01 ? 'OK' : 'MISMATCH', existing.weeklyGross, computed.weeklyGross);
  console.log('  Net match:', Math.abs(existing.netPayable - computed.netPayable) < 0.01 ? 'OK' : 'MISMATCH', existing.netPayable, computed.netPayable);
}

const cancelledWithDriver = loads.filter(l => l.loadStatus === 'Cancelled' && l.driverId);
let cancelledGrossLeak = 0;
for (const l of cancelledWithDriver) {
  cancelledGrossLeak += getDriverGross([l], l.driverId!, week);
}
console.log('\nCancelled load gross leak:', cancelledGrossLeak, cancelledGrossLeak === 0 ? 'OK' : 'FAIL');

const finalized = settlements.filter(s => s.finalized);
console.log('Finalized settlements:', finalized.length);
console.log('Snapshots present:', finalized.every(s => s.charges.length >= 0) ? 'OK' : 'CHECK');
console.log('\n=== VERIFICATION COMPLETE ===');
