import type { Vector3 } from '@babylonjs/core';
import type { BodyRegion } from '../Injuries';
export type CharacterDamageKind = "impact" | "melee" | "projectile" | "explosion" | "fire";
export interface CharacterImpact { kind: CharacterDamageKind; damage: number; health: number; region?: BodyRegion; point?: Vector3; direction?: Vector3; }
export interface CharacterInjury {
  kind: CharacterDamageKind;
  /** Null means incapacitated until an explicit encounter reset, not dead. */
  remaining: number | null;
}

/** Authored gameplay defaults, not medical thresholds or published Rockstar specifications. */
export const INJURY_RULES = {
  minorDownSeconds: 10,
  heavyDownSeconds: 18,
  recoverySeconds: 2.2,
  physicalSeconds: 6,
  fatalPhysicalSeconds: 8,
  criticalHealth: 35,
  seriousImpactDamage: 45,
  seriousBlastDamage: 20,
  seriousFireDamage: 20,
  physicalBodyLimit: 8,
} as const;

export function injuryFromImpact(impact: CharacterImpact, previous: CharacterInjury | null): CharacterInjury {
  const serious = previous?.remaining === null || impact.health <= INJURY_RULES.criticalHealth
    || impact.kind === "projectile"
    || (impact.kind === "explosion" && impact.damage >= INJURY_RULES.seriousBlastDamage)
    || (impact.kind === "fire" && impact.damage >= INJURY_RULES.seriousFireDamage)
    || (impact.kind === "impact" && impact.damage >= INJURY_RULES.seriousImpactDamage);
  return {
    kind: impact.kind,
    remaining: serious ? null : Math.max(previous?.remaining ?? 0,
      impact.damage > 25 ? INJURY_RULES.heavyDownSeconds : INJURY_RULES.minorDownSeconds),
  };
}
