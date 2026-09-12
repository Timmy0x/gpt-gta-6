import { UNARMED, WEAPON_SPECS } from './WeaponCatalog';
export type HandlingPhase = 'holstered' | 'stowing' | 'drawing' | 'ready';
/** The old weapon stays in the hand until stowing finishes; selection never grants ammo. */
export class WeaponHandling {
  current = 0;
  target = 0;
  phase: HandlingPhase = 'holstered';
  elapsed = 0;
  private holsterRequested = false;
  get duration() { return this.phase === 'stowing' ? WEAPON_SPECS[this.current].stow : WEAPON_SPECS[this.current].draw; }
  get progress() { return Math.min(1, this.elapsed / Math.max(.001, this.duration)); }
  get ready() { return this.phase === 'ready' && this.current !== UNARMED; }
  get visible() { return this.current !== UNARMED && (this.phase === 'ready' || this.phase === 'stowing' || this.phase === 'drawing' && this.progress >= .22); }
  request(index: number) {
    if (!WEAPON_SPECS[index]) return;
    this.target = index; this.holsterRequested = index === UNARMED;
    if (this.phase === 'holstered') {
      this.current = index;
      if (!this.holsterRequested) { this.phase = 'drawing'; this.elapsed = 0; }
    } else if (index !== this.current && this.phase !== 'stowing') { this.phase = 'stowing'; this.elapsed = 0; }
  }
  holster() {
    this.holsterRequested = true;
    if (this.phase !== 'holstered' && this.phase !== 'stowing') { this.phase = 'stowing'; this.elapsed = 0; }
  }
  draw() { if (this.phase === 'holstered') this.request(this.current === UNARMED ? 0 : this.current); }
  update(dt: number) {
    if (this.phase === 'holstered' || this.phase === 'ready') return;
    this.elapsed += Math.max(0, dt);
    if (this.elapsed < this.duration) return;
    if (this.phase === 'stowing') {
      this.current = this.target;
      this.phase = this.holsterRequested || this.current === UNARMED ? 'holstered' : 'drawing';
    } else this.phase = 'ready';
    this.elapsed = 0;
  }
  reset(index: number) { this.current = this.target = WEAPON_SPECS[index] ? index : 0; this.phase = 'holstered'; this.elapsed = 0; this.holsterRequested = false; }
}
