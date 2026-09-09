import { Vector3 } from "@babylonjs/core";
export class GameAudio {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  engine: OscillatorNode | null = null;
  engineGain: GainNode | null = null;
  enabled = true;
  start() {
    if (this.context) {
      void this.context.resume();
      return;
    }
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.24;
    this.master.connect(this.context.destination);
    this.engine = this.context.createOscillator();
    this.engine.type = "sawtooth";
    this.engine.frequency.value = 45;
    this.engineGain = this.context.createGain();
    this.engineGain.gain.value = 0;
    const filter = this.context.createBiquadFilter();
    filter.frequency.value = 300;
    this.engine.connect(filter).connect(this.engineGain).connect(this.master);
    this.engine.start();
  }
  update(speed: number, driving: boolean, stars: number, position: Vector3) {
    if (!this.context || !this.engine || !this.engineGain) return;
    const t = this.context.currentTime;
    this.engine.frequency.setTargetAtTime(35 + Math.abs(speed) * 4.2, t, 0.12);
    this.engineGain.gain.setTargetAtTime(
      driving && this.enabled ? 0.2 : 0,
      t,
      0.1,
    );
    const l = this.context.listener;
    l.positionX.value = position.x;
    l.positionY.value = position.y;
    l.positionZ.value = position.z;
    if (stars && Math.random() < 0.008)
      this.effect("siren", position.add(new Vector3(20, 0, 15)));
  }
  effect(type: string, position: Vector3) {
    if (
      !this.context ||
      !this.master ||
      !this.enabled ||
      ![position.x, position.y, position.z].every(Number.isFinite)
    )
      return;
    const ctx = this.context,
      t = ctx.currentTime;
    const osc = ctx.createOscillator(),
      gain = ctx.createGain(),
      panner = ctx.createPanner();
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;
    panner.refDistance = 6;
    panner.maxDistance = 100;
    panner.rolloffFactor = 0.8;
    osc.type = type === "siren" ? "sine" : "sawtooth";
    osc.frequency.setValueAtTime(
      type === "shot" ? 180 : type === "siren" ? 800 : 70,
      t,
    );
    osc.frequency.exponentialRampToValueAtTime(
      type === "siren" ? 450 : 25,
      t + 0.3,
    );
    gain.gain.setValueAtTime(type === "shot" ? 0.5 : 0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(gain).connect(panner).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.36);
  }
}
