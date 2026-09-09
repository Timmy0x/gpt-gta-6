export type PhysicalMaterial = "wood" | "metal" | "glass";
export type DamageKind = "impact" | "projectile" | "blast" | "fire" | "melee";
export const MATERIAL_RESPONSE: Record<
  PhysicalMaterial,
  {
    health: number;
    mass: number;
    ignitable: boolean;
    damage: Record<DamageKind, number>;
  }
> = {
  wood: {
    health: 58,
    mass: 18,
    ignitable: true,
    damage: { impact: 1, projectile: 1, blast: 1, fire: 1, melee: 0.65 },
  },
  metal: {
    health: 130,
    mass: 55,
    ignitable: true,
    damage: {
      impact: 0.65,
      projectile: 0.38,
      blast: 0.8,
      fire: 0.12,
      melee: 0.2,
    },
  },
  glass: {
    health: 36,
    mass: 28,
    ignitable: false,
    damage: { impact: 1.25, projectile: 1.6, blast: 1.5, fire: 0, melee: 1.25 },
  },
};
export function materialDamage(
  material: PhysicalMaterial,
  amount: number,
  kind: DamageKind,
): number {
  return Number.isFinite(amount)
    ? Math.max(0, amount) * MATERIAL_RESPONSE[material].damage[kind]
    : 0;
}
