import type { Vehicle, VehicleSystem } from '../vehicles/VehicleSystem';
import type { WorldLocation } from '../core/contracts';
import { distance, type Point2 } from '../core/math';

export const GARAGE_PRICES = { repair: 150, paint: 75 } as const;
export const PAINT_COLORS = [
  ['#128F86', 'Coastal teal'], ['#BA283B', 'Carmine'], ['#24344B', 'Midnight blue'],
  ['#DFD5BE', 'Pearl cream'], ['#3A3C40', 'Graphite'], ['#C5A25A', 'Champagne'],
] as const;
export function nearbyGarage(point: Point2, locations: readonly WorldLocation[]): WorldLocation | undefined {
  return locations.find(location => /garage/i.test(location.type) && distance(location, point) < 10);
}
/** Transactions validate their location, speed, budget and color before changing a live vehicle. */
export function serviceAtGarage(system: VehicleSystem, vehicle: Vehicle | null, locations: readonly WorldLocation[], cash: number, service: 'repair' | 'paint', color?: string): { cash: number; message: string; applied: boolean } {
  const fail = (message: string) => ({ cash, message, applied: false });
  if (!vehicle || !system.list.includes(vehicle) || !nearbyGarage(vehicle.root.position, locations)) return fail('Bring your vehicle to the garage entrance.');
  if (Math.abs(vehicle.speed) >= 2) return fail('Stop the vehicle before service.');
  const price = GARAGE_PRICES[service];
  if (!Number.isFinite(cash) || cash < price) return fail(`This service costs $${price}.`);
  if (service === 'paint' && (!color || !system.setPaint(vehicle, color))) return fail('Choose a valid paint color.');
  if (service === 'repair') system.repair(vehicle);
  return { cash: cash - price, message: `${service === 'paint' ? 'Paint applied' : 'Vehicle repaired'} · −$${price}`, applied: true };
}
