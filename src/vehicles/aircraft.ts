import type { VehicleKind, VehicleInput } from '../core/contracts';
import type { Input } from '../core/Input';
import type { Vehicle } from './VehicleSystem';

export const isAircraft = (kind: VehicleKind) => kind === 'plane' || kind === 'helicopter';

/** Project launch locations: the southern beach has no road traffic or starter-car obstruction. */
export const AIRCRAFT_SPAWNS = {
  plane: { x: 182.5, y: 0.95, z: -565, heading: 0, label: 'the clear south beach launch area' },
  helicopter: { x: 0, y: 0.95, z: -112, heading: 0, label: 'the boulevard landing area' },
} as const;

export function aircraftInput(input: Pick<Input, 'axis' | 'down'>, kind: VehicleKind, forwardSpeed: number): VehicleInput {
  const aircraft = isAircraft(kind);
  return {
    throttle: input.axis('y'),
    steer: input.axis('x'),
    brake: input.down('back') && forwardSpeed > 1 ? 1 : 0,
    handbrake: !aircraft && input.down('jump'),
    lift: Number(input.down('sprint') || (aircraft && input.down('jump'))) - Number(input.down('crouch')),
  };
}

const keyLabel = (code: string) => code.replace(/^Key/, '').replace(/Left$|Right$/, '').toUpperCase();
export function aircraftPrompt(v: Pick<Vehicle, 'kind' | 'speed' | 'grounded' | 'health' | 'engineRunning'>, input: Pick<Input, 'bindings' | 'gamepad'>): string {
  const pad = !!input.gamepad;
  const rise = pad ? 'A / L3' : `${keyLabel(input.bindings.jump)} / ${keyLabel(input.bindings.sprint)}`;
  const lower = pad ? 'B' : keyLabel(input.bindings.crouch);
  const throttle = pad ? 'LEFT STICK ↑' : keyLabel(input.bindings.forward);
  const brake = pad ? 'LEFT STICK ↓' : keyLabel(input.bindings.back);
  const exit = pad ? 'Y' : keyLabel(input.bindings.interact);
  if (v.health <= 0 || !v.engineRunning) return 'Engine disabled · Repair this aircraft to fly';
  if (v.kind === 'helicopter') return `${rise}  Rise · ${lower}  Descend / land · ${throttle}/${brake}  Move · ${exit}  Exit`;
  if (v.kind === 'plane') {
    if (v.grounded > 0 && v.speed < 25) return `${throttle}  Accelerate to 90 km/h · then hold ${rise} to take off · ${brake}  Brake`;
    return `${rise}  Nose up · ${lower}  Nose down · ${throttle}  Throttle · ${brake}  Slow / landing brake · ${exit}  Exit`;
  }
  return '';
}
