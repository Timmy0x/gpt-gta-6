export type WeaponFamily = 'pistol' | 'smg' | 'throwable' | 'rifle' | 'shotgun' | 'sniper' | 'revolver' | 'unarmed';
export interface WeaponSpec {
  id: string; name: string; family: WeaponFamily; capacity: number; reserve: number;
  delay: number; damage: number; reload: number; range: number; recoil: number;
  automatic: boolean; driveBy: boolean; pellets: number; spread: number;
  draw: number; stow: number; muzzle: number; scope?: readonly number[];
}
/** Metres and seconds. Authored handling, not unpublished Rockstar weapon statistics.
 * The first three indices are durable save identifiers from the original inventory. */
export const WEAPON_SPECS: readonly WeaponSpec[] = [
  { id: 'pistol', name: 'Pistol', family: 'pistol', capacity: 12, reserve: 180, delay: .27, damage: 32, reload: 1.45, range: 150, recoil: .013, automatic: false, driveBy: true, pellets: 1, spread: .004, draw: .58, stow: .4, muzzle: .182 },
  { id: 'smg', name: 'Micro SMG', family: 'smg', capacity: 30, reserve: 180, delay: .085, damage: 19, reload: 1.85, range: 110, recoil: .008, automatic: true, driveBy: true, pellets: 1, spread: .009, draw: .64, stow: .44, muzzle: .29 },
  { id: 'grenade', name: 'Grenade', family: 'throwable', capacity: 3, reserve: 6, delay: 1.3, damage: 140, reload: 1, range: 35, recoil: 0, automatic: false, driveBy: false, pellets: 1, spread: 0, draw: .52, stow: .38, muzzle: 0 },
  { id: 'carbine', name: 'Carbine Rifle', family: 'rifle', capacity: 30, reserve: 180, delay: .105, damage: 34, reload: 2.15, range: 280, recoil: .012, automatic: true, driveBy: false, pellets: 1, spread: .0035, draw: .82, stow: .56, muzzle: .551 },
  { id: 'pump', name: 'Pump Shotgun', family: 'shotgun', capacity: 8, reserve: 48, delay: .92, damage: 14, reload: 3.2, range: 65, recoil: .038, automatic: false, driveBy: false, pellets: 8, spread: .042, draw: .82, stow: .56, muzzle: .73 },
  { id: 'sniper', name: 'Sniper Rifle', family: 'sniper', capacity: 5, reserve: 40, delay: 1.35, damage: 110, reload: 2.8, range: 850, recoil: .029, automatic: false, driveBy: false, pellets: 1, spread: .0003, draw: .92, stow: .62, muzzle: .848, scope: [2, 4, 8] },
  { id: 'revolver', name: 'Heavy Revolver', family: 'revolver', capacity: 6, reserve: 60, delay: .62, damage: 62, reload: 2.45, range: 170, recoil: .025, automatic: false, driveBy: true, pellets: 1, spread: .003, draw: .64, stow: .44, muzzle: .29 },
  { id: 'unarmed', name: 'Unarmed', family: 'unarmed', capacity: 0, reserve: 0, delay: .62, damage: 35, reload: 0, range: 1.7, recoil: 0, automatic: false, driveBy: false, pellets: 1, spread: 0, draw: .2, stow: 0, muzzle: 0 },
];
export const UNARMED = WEAPON_SPECS.findIndex(w => w.family === 'unarmed');
export function validWeaponSave(value: unknown): value is { selected: number; magazines: number[]; reserves: number[] } {
  if (!value || typeof value !== 'object') return false;
  const s = value as { selected: number; magazines: number[]; reserves: number[] };
  return Array.isArray(s.magazines) && Array.isArray(s.reserves)
    && [3, WEAPON_SPECS.length].includes(s.magazines.length) && s.reserves.length === s.magazines.length
    && Number.isInteger(s.selected) && s.selected >= 0 && s.selected < s.magazines.length
    && s.magazines.every((n, i) => Number.isInteger(n) && n >= 0 && n <= WEAPON_SPECS[i].capacity)
    && s.reserves.every(n => Number.isInteger(n) && n >= 0 && n <= 1_000_000);
}
