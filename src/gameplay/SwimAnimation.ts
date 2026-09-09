/** Presentation follows velocity while Havok retains its stable upright capsule. */
export class SwimAnimation {
  blend = 0;
  stroke = 0;
  pitch = 0;
  roll = 0;
  phase = 0;
  update(dt: number, active: boolean, speed: number, submerged: boolean, verticalSpeed: number): void {
    const smooth = 1 - Math.exp(-Math.max(0, dt) * 7);
    this.blend += (Number(active) - this.blend) * smooth;
    const travelling = Math.min(1, Math.hypot(speed, submerged ? verticalSpeed : 0) / 1.6);
    this.stroke += (travelling - this.stroke) * smooth;
    this.phase += dt * (2.2 + travelling * 3.4);
    // Surface travel keeps the head raised; immersed travel pitches along motion.
    const incline = submerged && speed > .15 ? Math.atan2(-verticalSpeed, speed) : 0;
    const targetPitch = active ? .12 + this.stroke * ((submerged ? 1.48 : 1.17) + Math.max(-.65, Math.min(.65, incline)) - .12) : 0;
    this.pitch += (targetPitch - this.pitch) * smooth;
    this.roll = Math.sin(this.phase) * .075 * this.stroke * this.blend;
  }
  reset(): void { this.blend = this.stroke = this.pitch = this.roll = this.phase = 0; }
}
