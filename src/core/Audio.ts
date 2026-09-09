import { Vector3 } from "@babylonjs/core";
type Source = {
  id: string;
  type: "engine" | "siren";
  position: Vector3;
  speed: number;
};
type Voice = {
  osc: OscillatorNode;
  gain: GainNode;
  panner: PannerNode;
  type: Source["type"];
};
export class GameAudio {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  engine: OscillatorNode | null = null;
  engineGain: GainNode | null = null;
  enabled = true;
  private ambience: GainNode | null = null;
  private ambientFilter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Map<string, Voice>();
  private effects = 0;
  private footTimer = 0;
  private swimTimer = 0;
  private underwaterFilter: BiquadFilterNode | null = null;
  start() {
    if (this.context) {
      void this.context.resume();
      return;
    }
    this.context = new AudioContext();
    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.gain.value = 0.24;
    this.underwaterFilter = ctx.createBiquadFilter();
    this.underwaterFilter.type = "lowpass";
    this.underwaterFilter.frequency.value = 20000;
    this.master.connect(this.underwaterFilter).connect(ctx.destination);
    this.engine = ctx.createOscillator();
    this.engine.type = "sawtooth";
    this.engine.frequency.value = 45;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.frequency.value = 300;
    this.engine.connect(filter).connect(this.engineGain).connect(this.master);
    this.engine.start();
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    let last = 0;
    for (let n = 0; n < samples.length; n++) {
      last = (last + (Math.random() * 2 - 1) * 0.14) / 1.14;
      samples[n] = last;
    }
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    this.ambientFilter = ctx.createBiquadFilter();
    this.ambientFilter.type = "lowpass";
    this.ambientFilter.frequency.value = 800;
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0;
    wind
      .connect(this.ambientFilter)
      .connect(this.ambience)
      .connect(this.master);
    wind.start();
  }
  update(
    speed: number,
    driving: boolean,
    _stars: number,
    position: Vector3,
    options?: {
      dt: number;
      heading: number;
      weather: string;
      paused: boolean;
      footSpeed: number;
      underwater?: boolean;
      swimSpeed?: number;
      sources: Source[];
    },
  ) {
    if (!this.context || !this.engine || !this.engineGain || !this.master)
      return;
    const ctx = this.context,
      t = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.enabled ? 0.24 : 0, t, 0.08);
    this.engine.frequency.setTargetAtTime(35 + Math.abs(speed) * 4.2, t, 0.12);
    this.engineGain.gain.setTargetAtTime(driving ? 0.2 : 0, t, 0.1);
    const l = ctx.listener;
    l.positionX.value = position.x;
    l.positionY.value = position.y;
    l.positionZ.value = position.z;
    const yaw = options?.heading ?? 0;
    l.forwardX.value = Math.sin(yaw);
    l.forwardY.value = 0;
    l.forwardZ.value = Math.cos(yaw);
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
    if (!options) return;
    this.underwaterFilter?.frequency.setTargetAtTime(options.underwater ? 650 : 20000, t, .15);
    this.swimTimer -= options.dt;
    if (!options.paused && (options.swimSpeed ?? 0) > .2 && this.swimTimer <= 0) {
      this.effect("swim", position);
      this.swimTimer = .75;
    }
    const rain = options.weather === "Rain",
      coastal = position.x > 140;
    this.ambience?.gain.setTargetAtTime(
      options.paused ? 0 : rain ? 0.4 : coastal ? 0.18 : 0.055,
      t,
      0.8,
    );
    this.ambientFilter?.frequency.setTargetAtTime(
      rain ? 3500 : coastal ? 900 : 450,
      t,
      0.8,
    );
    const selected = options.paused
      ? []
      : options.sources
          .filter(
            (s) => Vector3.DistanceSquared(s.position, position) < 180 * 180,
          )
          .sort(
            (a, b) =>
              Vector3.DistanceSquared(a.position, position) -
              Vector3.DistanceSquared(b.position, position),
          )
          .slice(0, 8);
    const ids = new Set(selected.map((s) => s.id));
    for (const [id, v] of this.voices)
      if (!ids.has(id)) {
        v.osc.stop();
        v.osc.disconnect();
        v.gain.disconnect();
        v.panner.disconnect();
        this.voices.delete(id);
      }
    for (const source of selected) {
      let v = this.voices.get(source.id);
      if (!v) {
        const osc = ctx.createOscillator(),
          gain = ctx.createGain(),
          panner = this.panner(source.position);
        osc.type = source.type === "siren" ? "sine" : "sawtooth";
        gain.gain.value = 0;
        osc.connect(gain).connect(panner).connect(this.master);
        osc.start();
        v = { osc, gain, panner, type: source.type };
        this.voices.set(source.id, v);
      }
      v.panner.positionX.value = source.position.x;
      v.panner.positionY.value = source.position.y;
      v.panner.positionZ.value = source.position.z;
      v.osc.frequency.setTargetAtTime(
        source.type === "siren"
          ? 650 + Math.sin(t * 5) * 230
          : 38 + Math.abs(source.speed) * 3.4,
        t,
        0.05,
      );
      v.gain.gain.setTargetAtTime(
        source.type === "siren" ? 0.12 : 0.045,
        t,
        0.1,
      );
    }
    this.footTimer -= options.dt;
    if (
      !options.paused &&
      !driving &&
      options.footSpeed > 0.7 &&
      this.footTimer <= 0
    ) {
      this.effect("footstep", position);
      this.footTimer = options.footSpeed > 5 ? 0.29 : 0.46;
    }
  }
  private panner(position: Vector3) {
    const p = this.context!.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = 5;
    p.maxDistance = 180;
    p.rolloffFactor = 1.1;
    p.positionX.value = position.x;
    p.positionY.value = position.y;
    p.positionZ.value = position.z;
    return p;
  }
  effect(type: string, position: Vector3) {
    if (
      !this.context ||
      !this.master ||
      !this.enabled ||
      this.effects >= 32 ||
      ![position.x, position.y, position.z].every(Number.isFinite)
    )
      return;
    const ctx = this.context,
      t = ctx.currentTime,
      foot = type === "footstep",
      swim = type === "swim",
      shot = type === "shot",
      explosion = type === "explosion",
      siren = type === "siren",
      horn = type === "horn";
    const duration = swim ? .5 : foot ? 0.11 : explosion ? 1.1 : siren ? 0.7 : 0.35;
    const gain = ctx.createGain(),
      panner = this.panner(position),
      filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = swim ? 1800 : foot ? 600 : shot ? 6500 : explosion ? 650 : 1400;
    const source: OscillatorNode | AudioBufferSourceNode =
      !siren && !horn && this.noise ? ctx.createBufferSource() : ctx.createOscillator();
    if (source instanceof AudioBufferSourceNode) {
      source.buffer = this.noise;
      source.playbackRate.value = swim ? .55 : shot ? 2.3 : foot ? 0.8 : 0.6;
    } else {
      source.type = horn ? "triangle" : "sine";
      source.frequency.setValueAtTime(horn ? 370 : siren ? 800 : 80, t);
      source.frequency.exponentialRampToValueAtTime(
        horn ? 370 : siren ? 450 : 25,
        t + duration,
      );
    }
    gain.gain.setValueAtTime(
      swim ? .12 : foot ? 0.08 : shot ? 1.2 : explosion ? 1.8 : 0.5,
      t,
    );
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(panner).connect(this.master);
    this.effects++;
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      panner.disconnect();
      this.effects--;
    };
    source.start(t);
    source.stop(t + duration);
  }
  getStats() {
    return {
      voices: this.voices.size,
      effects: this.effects,
      state: this.context?.state ?? "not-started",
    };
  }
  dispose() {
    void this.context?.close();
    this.voices.clear();
    this.context = null;
  }
}
