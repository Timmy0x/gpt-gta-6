/** Bounded raw frame durations. Recording stays O(1) after the 30-minute buffer fills. */
export class FrameHistory {
  private readonly values: Float64Array;
  private cursor = 0;
  private count = 0;
  constructor(capacity = 108000) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("Invalid frame history capacity");
    this.values = new Float64Array(capacity);
  }
  push(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.values[this.cursor] = milliseconds;
    this.cursor = (this.cursor + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
  }
  latest(limit = this.count): number[] {
    const length = Math.max(0, Math.min(this.count, Math.floor(limit)));
    const start = (this.cursor - length + this.values.length) % this.values.length;
    return Array.from({ length }, (_, i) => this.values[(start + i) % this.values.length]);
  }
}
