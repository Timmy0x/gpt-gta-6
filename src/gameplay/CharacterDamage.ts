import { Vector3 } from '@babylonjs/core';
import type { Character } from './Character';
import { advanceBodyInjuries, applyBodyImpact, regionalHealthDamage } from './Injuries';
import { bodyRegionAtPoint } from './combat/BodyHitRegions';
import type { CharacterDamageKind, CharacterImpact } from './combat/injuries';

export type DamageContact = Pick<CharacterImpact, 'region' | 'point' | 'direction'>;
/** Game recovery shares the injury's quiet period and simulation clock. A new
 * wound delays health recovery too; fatal actors never recover through this route. */
export function recoverCharacter(model: Character, health: number, dt: number, maximum = 100): number {
  if (health <= 0 || model.dead || !Number.isFinite(dt) || dt <= 0) return health;
  const state = model.bodyInjuries;
  if (!state) return health;
  const delay = Math.max(state.systemic.healDelay, ...Object.values(state.regions).map(region => region.healDelay));
  advanceBodyInjuries(state, dt);
  return Math.min(maximum, health + Math.max(0, dt - delay) * .4);
}
/** One damage route for player, civilians and responders. Armor covers the torso;
 * local impairment receives only the unabsorbed part of the original impact. */
export function damageCharacter(model: Character, health: number, amount: number, kind: CharacterDamageKind, contact: DamageContact = {}, armor = 0) {
  const region = contact.region ?? (contact.point ? bodyRegionAtPoint(model, contact.point) : 'torso');
  const raw = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const scaled = regionalHealthDamage(raw, region, kind);
  const absorbed = region === 'torso' && kind === 'projectile' ? Math.min(armor, scaled * .55) : 0;
  const remaining = Math.max(0, health - scaled + absorbed), localDamage = raw * (scaled > 0 ? 1 - absorbed / scaled : 0);
  const impact: CharacterImpact = {...contact, kind, region, damage: localDamage, health: remaining};
  if (localDamage > 0) model.bodyInjuries = applyBodyImpact(model.bodyInjuries, {...impact, region});
  if (remaining <= 0) model.dead = true;
  const direction = contact.direction?.normalizeToNew() ?? model.root.forward.negate();
  const impulseScale = kind === 'explosion' ? .8 : kind === 'impact' ? .9 : kind === 'melee' ? .4 : kind === 'projectile' ? .035 : 0;
  const impulse = direction.lengthSquared() > 1e-8 ? direction.scale(Math.min(120, raw * impulseScale)) : Vector3.Zero();
  return {health: remaining, armor: Math.max(0, armor - absorbed), impact, impulse};
}
