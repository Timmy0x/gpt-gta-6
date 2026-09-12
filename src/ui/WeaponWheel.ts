import type { Input } from '../core/Input';
import { WEAPON_SPECS, UNARMED } from '../gameplay/combat/WeaponCatalog';

const ICONS = [
  'M12 22h44v10H38l-5 22H20l5-24H12z M48 18h5v4M17 18h7v4',
  'M7 20h45v16H31l-2 22H19l2-22H7z M52 24h10v6M12 36v11h-5',
  'M28 19h10l6 9 4 19-7 12H24l-7-12 4-19z M29 19V8h11v8l7 20M29 9l-8 1-3 8',
  'M4 29h15l6-8h25v6h13v6H44l-3 8H30l-4 14H15l5-20H4z M31 38l5 18h10l-5-18',
  'M2 27h61v6H36l-9 8-8 15H5l13-22H2z M29 34h19v5H29',
  'M2 30h61v5H41l-8 7H19L9 53H1l13-19 M24 24h25v5H24z M28 19h17v5H28',
  'M8 24h45v10H36l-8 22H15l5-22H8z M24 21h14v18H24z M53 27h10v5',
  'M17 41V23q0-6 7-6v-4q0-8 8-3 5-7 10 0 9-3 9 7v17q0 13-12 22H26L14 40q-4-10 3-12',
];
export function weaponWheelSector(x: number, y: number, fallback: number): number {
  if (Math.hypot(x, y) < 24) return fallback;
  return (Math.round((Math.atan2(y, x) + Math.PI / 2) / (Math.PI / 4)) + 8) % 8;
}
const ORDER = [UNARMED, 0, 1, 3, 4, 5, 2, 6];
export class WeaponWheel {
  active = false;
  highlighted = 0;
  private held = 0;
  private wasDown = false;
  private x = 0;
  private y = 0;
  private root: HTMLDivElement;
  private slots: HTMLDivElement[];
  private name: HTMLElement;
  private ammo: HTMLElement;
  onSelect = (index: number) => {};
  onToggle = () => {};
  constructor() {
    this.root = document.createElement('div'); this.root.id = 'weapon-wheel'; this.root.className = 'hidden';
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', 'Weapon wheel');
    this.root.innerHTML = `<div class="weapon-ring">${ORDER.map((index, slot) => {
      const angle = slot * Math.PI / 4;
      return `<div class="weapon-slot" data-weapon="${index}" style="--wx:${Math.sin(angle) * 39}%;--wy:${-Math.cos(angle) * 39}%" role="option" aria-label="${WEAPON_SPECS[index].name}"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="${ICONS[index]}"/></svg><small></small></div>`;
    }).join('')}<div class="wheel-center"><strong></strong><span></span></div></div>`;
    document.querySelector('#ui')!.append(this.root);
    this.slots = [...this.root.querySelectorAll<HTMLDivElement>('.weapon-slot')];
    this.name = this.root.querySelector('strong')!; this.ammo = this.root.querySelector('.wheel-center span')!;
  }
  update(input: Input, dt: number, selected: number, magazines: readonly number[], reserves: readonly number[], inCar: boolean, enabled: boolean) {
    const down = enabled && input.down('weaponWheel');
    if (!enabled) { this.cancel(); return; }
    if (down && !this.wasDown) { this.held = 0; this.highlighted = selected; this.x = this.y = 0; }
    if (down) {
      this.held += dt;
      if (this.held >= .16) this.active = true;
    } else if (this.wasDown) {
      if (this.active) {
        if (!inCar || WEAPON_SPECS[this.highlighted].driveBy || this.highlighted === UNARMED) this.onSelect(this.highlighted);
      } else this.onToggle();
      this.active = false;
    }
    this.wasDown = down;
    this.root.classList.toggle('hidden', !this.active);
    if (!this.active) return;
    const stick = input.gamepad?.axes;
    if (stick && Math.hypot(stick[2], stick[3]) > .2) { this.x = stick[2] * 110; this.y = stick[3] * 110; }
    else { this.x += input.dx; this.y += input.dy; const radius = Math.hypot(this.x, this.y); if (radius > 135) { this.x *= 135 / radius; this.y *= 135 / radius; } }
    this.highlighted = ORDER[weaponWheelSector(this.x, this.y, ORDER.indexOf(this.highlighted))];
    if (input.wheel) {
      const slot = (ORDER.indexOf(this.highlighted) + Math.sign(input.wheel) + 8) % 8;
      this.highlighted = ORDER[slot]; const angle = slot * Math.PI / 4; this.x = Math.sin(angle) * 90; this.y = -Math.cos(angle) * 90;
    }
    const spec = WEAPON_SPECS[this.highlighted];
    this.root.style.setProperty('--selected-angle', `${ORDER.indexOf(this.highlighted) * 45 - 22.5}deg`);
    this.name.textContent = spec.name;
    this.ammo.textContent = inCar && !spec.driveBy && this.highlighted !== UNARMED ? '—' : spec.capacity ? `${magazines[this.highlighted]} / ${reserves[this.highlighted]}` : '';
    for (const slot of this.slots) {
      const index = Number(slot.dataset.weapon), weapon = WEAPON_SPECS[index];
      slot.classList.toggle('selected', index === this.highlighted);
      slot.classList.toggle('unavailable', inCar && !weapon.driveBy && index !== UNARMED);
      slot.setAttribute('aria-selected', String(index === this.highlighted));
      slot.querySelector('small')!.textContent = weapon.capacity ? String(magazines[index] + reserves[index]) : '';
    }
  }
  cancel() { this.active = false; this.wasDown = false; this.held = 0; this.root.classList.add('hidden'); }
  dispose() { this.root.remove(); }
}
