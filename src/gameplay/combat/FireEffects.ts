import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Vector3,
  type Scene,
} from "@babylonjs/core";
interface Flame {
  key: string;
  position: Vector3;
  meshes: Mesh[];
  phase: number;
}
/** Bounded, pooled-material flames and rising smoke; duration is owned by the damaged object. */
export class FireEffects {
  readonly active = new Map<string, Flame>();
  private flame: PBRMaterial;
  private smoke: PBRMaterial;
  private time = 0;
  constructor(private scene: Scene) {
    this.flame = new PBRMaterial("fire/flame", scene);
    this.flame.unlit = true;
    this.flame.albedoColor.set(1, 0.34, 0.025);
    this.flame.emissiveColor.set(1, 0.24, 0.012);
    this.flame.alpha = 0.78;
    this.smoke = new PBRMaterial("fire/smoke", scene);
    this.smoke.unlit = true;
    this.smoke.albedoColor = Color3.FromHexString("#393939");
    this.smoke.alpha = 0.3;
  }
  set(key: string, position: Vector3): void {
    const old = this.active.get(key);
    if (old) {
      old.position.copyFrom(position);
      return;
    }
    if (this.active.size >= 12) return;
    const meshes: Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const m = MeshBuilder.CreateSphere(
        "fire/" + key,
        { diameter: 1, segments: 5 },
        this.scene,
      );
      m.material = i < 3 ? this.flame : this.smoke;
      m.isPickable = false;
      m.metadata = { combatEffect: true };
      meshes.push(m);
    }
    this.active.set(key, {
      key,
      position: position.clone(),
      meshes,
      phase: this.active.size * 1.67,
    });
  }
  remove(key: string): void {
    const flame = this.active.get(key);
    if (!flame) return;
    for (const mesh of flame.meshes) mesh.dispose();
    this.active.delete(key);
  }
  update(dt: number): void {
    this.time += dt;
    for (const flame of this.active.values())
      for (let i = 0; i < flame.meshes.length; i++) {
        const mesh = flame.meshes[i],
          phase = this.time * (i < 3 ? 3.5 : 0.6) + flame.phase + i * 0.83;
        if (i < 3) {
          const pulse = 0.7 + 0.3 * Math.sin(phase * 4);
          mesh.position
            .copyFrom(flame.position)
            .addInPlace(
              new Vector3(
                Math.sin(i * 2.1) * 0.22,
                0.15 + pulse * 0.32,
                Math.cos(i * 2.1) * 0.22,
              ),
            );
          mesh.scaling.set(
            0.22 + pulse * 0.13,
            0.65 + pulse * 0.55,
            0.25 + pulse * 0.11,
          );
        } else {
          const rise = ((phase % 2) + 2) % 2;
          mesh.position
            .copyFrom(flame.position)
            .addInPlace(
              new Vector3(
                rise * 0.18 + Math.sin(i) * 0.15,
                0.65 + rise * 1.4,
                Math.cos(i) * 0.13,
              ),
            );
          mesh.scaling.setAll(0.36 + rise * 0.38);
          mesh.visibility = (1 - rise / 2) * 0.65;
        }
      }
  }
  dispose(): void {
    for (const key of [...this.active.keys()]) this.remove(key);
    this.flame.dispose();
    this.smoke.dispose();
  }
}
