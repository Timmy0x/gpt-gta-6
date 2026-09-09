import {
  Color3,
  Color4,
  DynamicTexture,
  ParticleSystem,
  PBRMaterial,
  Ray,
  SpotLight,
  Texture,
  Vector3,
  type Scene,
} from "@babylonjs/core";

/** Local weather presentation. Physical wet-road grip is supplied separately to vehicles. */
export class Atmosphere {
  private rain: ParticleSystem;
  private texture: DynamicTexture;
  wetness = 0;
  sheltered = false;
  private lamps: SpotLight[] = [];
  constructor(
    private scene: Scene,
    private lampPositions: Vector3[] = [],
  ) {
    for (let i = 0; i < 4; i++) {
      const lamp = new SpotLight(
        "nearby-street-lamp-" + i,
        new Vector3(0, -100, 0),
        new Vector3(0, -1, 0),
        1.8,
        1.3,
        scene,
      );
      lamp.diffuse = new Color3(1, 0.76, 0.42);
      lamp.range = 26;
      lamp.intensity = 0;
      this.lamps.push(lamp);
    }
    for (const material of scene.materials)
      if (material instanceof PBRMaterial) material.maxSimultaneousLights = 8;
    scene.onNewMaterialAddedObservable.add((material) => {
      if (material instanceof PBRMaterial) material.maxSimultaneousLights = 8;
    });
    this.texture = new DynamicTexture(
      "rain-streak",
      { width: 8, height: 64 },
      scene,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
    );
    const c = this.texture.getContext();
    c.clearRect(0, 0, 8, 64);
    const gradient = c.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, "rgba(220,238,250,0)");
    gradient.addColorStop(0.6, "rgba(220,238,250,.65)");
    gradient.addColorStop(1, "rgba(220,238,250,0)");
    c.fillStyle = gradient;
    c.fillRect(2, 0, 4, 64);
    this.texture.hasAlpha = true;
    this.texture.update();
    this.rain = new ParticleSystem("local rainfall", 1000, scene);
    this.rain.particleTexture = this.texture;
    this.rain.emitter = Vector3.Zero();
    this.rain.minEmitBox = new Vector3(-18, 9, -18);
    this.rain.maxEmitBox = new Vector3(18, 13, 18);
    this.rain.direction1 = new Vector3(1, -1, 0);
    this.rain.direction2 = new Vector3(1.5, -1, 0.1);
    this.rain.minEmitPower = 12;
    this.rain.maxEmitPower = 17;
    this.rain.gravity = new Vector3(0, -22, 0);
    this.rain.minLifeTime = 0.35;
    this.rain.maxLifeTime = 0.7;
    this.rain.minSize = 0.14;
    this.rain.maxSize = 0.25;
    this.rain.minScaleX = 0.18;
    this.rain.maxScaleX = 0.25;
    this.rain.minScaleY = 2;
    this.rain.maxScaleY = 3;
    this.rain.color1 = new Color4(0.7, 0.81, 0.9, 0.4);
    this.rain.color2 = new Color4(0.8, 0.9, 1, 0.5);
    this.rain.colorDead = new Color4(0.65, 0.8, 0.9, 0);
    this.rain.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.rain.emitRate = 0;
    this.rain.start();
  }
  update(
    dt: number,
    position: Vector3,
    time: number,
    weather: string,
    paused: boolean,
  ) {
    const raining = weather === "Rain";
    this.wetness +=
      ((raining ? 1 : 0) - this.wetness) *
      Math.min(1, dt * (raining ? 0.8 : 0.05));
    const daylight = Math.max(0, Math.sin(((time - 6) / 24) * Math.PI * 2));
    const nearby = this.lampPositions
      .filter((p) => Vector3.DistanceSquared(p, position) < 85 * 85)
      .sort(
        (a, b) =>
          Vector3.DistanceSquared(a, position) -
          Vector3.DistanceSquared(b, position),
      )
      .slice(0, 4);
    const night = Math.max(0, 1 - daylight * 5);
    this.lamps.forEach((lamp, index) => {
      const p = nearby[index];
      if (p) lamp.position.copyFrom(p);
      lamp.intensity = p ? night * 130 : 0;
    });
    const day =
      weather === "Haze"
        ? new Color3(0.61, 0.62, 0.57)
        : raining
          ? new Color3(0.29, 0.35, 0.39)
          : new Color3(0.42, 0.66, 0.79);
    const sky = Color3.Lerp(new Color3(0.013, 0.024, 0.052), day, daylight);
    this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    this.scene.fogColor = sky;
    const roof = this.scene.pickWithRay(
      new Ray(position.add(new Vector3(0, 0.9, 0)), Vector3.Up(), 20),
      (m) => !!m.metadata?.cameraBlocker,
    );
    this.sheltered = !!roof?.hit;
    (this.rain.emitter as Vector3).copyFrom(position);
    this.rain.emitRate = raining && !this.sheltered && !paused ? 650 : 0;
    this.rain.updateSpeed = paused ? 0 : Math.min(0.06, dt);
  }
  getStats() {
    return {
      wetness: this.wetness,
      sheltered: this.sheltered,
      particles: this.rain.getActiveCount(),
    };
  }
  dispose() {
    this.rain.dispose();
    this.texture.dispose();
    this.lamps.forEach((l) => l.dispose());
  }
}
