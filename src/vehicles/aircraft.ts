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
  const rise = pad ? 'A' : keyLabel(input.bindings.jump);
  const lower = pad ? 'B' : keyLabel(input.bindings.crouch);
  const throttle = pad ? 'LEFT STICK ↑' : keyLabel(input.bindings.forward);
  const brake = pad ? 'LEFT STICK ↓' : keyLabel(input.bindings.back);
  const exit = pad ? 'Y' : keyLabel(input.bindings.interact);
  if (v.health <= 0 || !v.engineRunning) return `${keyLabel(input.bindings.repair)}  Repair`;
  if (v.kind === 'helicopter') return `${rise} ↑  ${lower} ↓ · ${throttle}/${brake} · ${exit} Exit`;
  if (v.kind === 'plane') {
    if (v.grounded > 0 && v.speed < 25) return `${throttle} 90 km/h · ${rise} ↑ · ${lower} ↓`;
    return `${throttle}/${brake} · ${rise} ↑  ${lower} ↓ · ${exit} Exit`;
  }
  return '';
}
