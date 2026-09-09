import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Vector3,
  type Material,
  type Scene,
} from "@babylonjs/core";
import type { Character } from "../Character";

export const WEAPON_SPECS = [
  {
    name: "Pistol",
    capacity: 12,
    delay: 0.27,
    damage: 32,
    reload: 1.25,
    range: 150,
    recoil: 0.013,
  },
  {
    name: "SMG",
    capacity: 30,
    delay: 0.085,
    damage: 19,
    reload: 1.65,
    range: 110,
    recoil: 0.008,
  },
  {
    name: "Grenade",
    capacity: 3,
    delay: 1.3,
    damage: 140,
    reload: 1.0,
    range: 35,
    recoil: 0,
  },
];

/** Persistent per-weapon magazines prevent free refills or discarded rounds when switching. */
export class WeaponInventory {
  selected = 0;
  magazines = [12, 30, 3];
  reserves = [180, 180, 6];
  reloadRemaining = 0;
  unlimited = false;
  get ammo() {
    return this.magazines[this.selected];
  }
  set ammo(value: number) {
    this.magazines[this.selected] = Math.max(
      0,
      Math.min(
        WEAPON_SPECS[this.selected].capacity,
        Math.floor(Number.isFinite(value) ? value : 0),
      ),
    );
  }
  get reserve() {
    return this.reserves[this.selected];
  }
  set reserve(value: number) {
    this.reserves[this.selected] = Math.max(
      0,
      Math.floor(Number.isFinite(value) ? value : 0),
    );
  }
  select(index: number): boolean {
    if (
      !Number.isInteger(index) ||
      !WEAPON_SPECS[index] ||
      index === this.selected
    )
      return false;
    this.selected = index;
    this.reloadRemaining = 0;
    return true;
  }
  reload(): boolean {
    if (
      this.reloadRemaining > 0 ||
      this.ammo >= WEAPON_SPECS[this.selected].capacity ||
      (!this.unlimited && this.reserve <= 0)
    )
      return false;
    this.reloadRemaining = WEAPON_SPECS[this.selected].reload;
    return true;
  }
  update(dt: number): void {
    if (this.reloadRemaining <= 0) return;
    this.reloadRemaining = Math.max(0, this.reloadRemaining - dt);
    if (this.reloadRemaining === 0) {
      const need = WEAPON_SPECS[this.selected].capacity - this.ammo,
        count = this.unlimited ? need : Math.min(need, this.reserve);
      this.ammo += count;
      if (!this.unlimited) this.reserve -= count;
    }
  }
  consume(): boolean {
    if (this.reloadRemaining > 0) return false;
    if (this.unlimited) return true;
    if (this.ammo <= 0) {
      this.reload();
      return false;
    }
    this.ammo--;
    return true;
  }
}

/** Original visible firearm geometry attached to the actual right-hand skeleton joint. */
export class HeldWeapon {
  root: Mesh | null = null;
  private owner: Character | null = null;
  private selected = -1;
  private materials: PBRMaterial[] = [];
  private kick = 0;
  private mergedMaterial: Material | null = null;
  constructor(private scene: Scene) {}
  update(
    character: Character,
    index: number,
    visible: boolean,
    dt: number,
    reloading = false,
  ): void {
    if (
      this.owner !== character ||
      this.selected !== index ||
      !this.root ||
      this.root.isDisposed()
    )
      this.build(character, index);
    character.root.computeWorldMatrix(true);
    character.torso.computeWorldMatrix(true);
    character.skeleton.computeAbsoluteMatrices(true);
    character.skeleton.prepare(true);
    this.kick = Math.max(0, this.kick - dt * 9);
    this.root!.setEnabled(visible);
    this.root!.position.set(0, -0.083 + this.kick * 0.035, 0.022);
    this.root!.rotation.set(
      Math.PI / 2 + (reloading ? -0.45 : 0) - this.kick * 0.1,
      0,
      reloading ? -0.25 : 0,
    );
    this.root!.computeWorldMatrix(true);
  }
  recoil(): void {
    this.kick = 1;
  }
  muzzle(): Vector3 {
    if (!this.root) return Vector3.Zero();
    return Vector3.TransformCoordinates(
      new Vector3(
        0,
        this.selected === 2 ? 0 : 0.065,
        this.selected === 1 ? 0.43 : this.selected === 0 ? 0.19 : 0,
      ),
      this.root.computeWorldMatrix(true),
    );
  }
  private build(character: Character, index: number): void {
    this.disposeModel();
    this.owner = character;
    this.selected = index;
    const root = new Mesh("held-" + WEAPON_SPECS[index].name, this.scene);
    this.root = root;
    const material = (name: string, color: string, metallic: number) => {
      const m = new PBRMaterial("weapon/" + name, this.scene);
      m.albedoColor = Color3.FromHexString(color);
      m.metallic = metallic;
      m.roughness = 0.45;
      this.materials.push(m);
      return m;
    };
    const steel = material("blued-steel", "#333e47", 0.8),
      grip = material("polymer", "#191e25", 0.1),
      detail = material("sights", "#9ba49a", 0.6);
    const pieces: Mesh[] = [];
    const box = (
      name: string,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      mat = steel,
    ) => {
      const m = MeshBuilder.CreateBox(
        name,
        { width: w, height: h, depth: d },
        this.scene,
      );
      m.position.set(x, y, z);
      m.material = mat;
      pieces.push(m);
      return m;
    };
    const cylinder = (
      name: string,
      diameter: number,
      length: number,
      x: number,
      y: number,
      z: number,
      mat = steel,
    ) => {
      const m = MeshBuilder.CreateCylinder(
        name,
        { diameter, height: length, tessellation: 10 },
        this.scene,
      );
      m.position.set(x, y, z);
      m.rotation.x = Math.PI / 2;
      m.material = mat;
      pieces.push(m);
      return m;
    };
    if (index === 0) {
      box("pistol-slide", 0.047, 0.057, 0.215, 0, 0.063, 0.048);
      box("receiver", 0.043, 0.031, 0.15, 0, 0.028, 0.012, grip);
      box("grip", 0.044, 0.118, 0.067, 0, -0.026, -0.025, grip).rotation.x =
        -0.19;
      cylinder("barrel", 0.021, 0.17, 0, 0.064, 0.08);
      box("muzzle-bore", 0.013, 0.013, 0.006, 0, 0.065, 0.169, grip);
      box("trigger-guard", 0.01, 0.052, 0.065, 0, -0.021, 0.036);
      box("trigger", 0.007, 0.028, 0.014, 0, -0.015, 0.018, grip);
      box("front-sight", 0.009, 0.015, 0.013, 0, 0.1, 0.135, detail);
      box("rear-sight", 0.023, 0.012, 0.014, 0, 0.1, -0.042, detail);
      for (let i = 0; i < 4; i++)
        for (const side of [-1, 1])
          box(
            "slide-serration",
            0.004,
            0.039,
            0.005,
            side * 0.025,
            0.066,
            -0.045 + i * 0.013,
            grip,
          );
    } else if (index === 1) {
      box("smg-receiver", 0.068, 0.092, 0.29, 0, 0.052, 0.083);
      cylinder("barrel", 0.028, 0.205, 0, 0.057, 0.324);
      box("grip", 0.055, 0.14, 0.078, 0, -0.037, 0.012, grip).rotation.x =
        -0.12;
      box("magazine", 0.041, 0.188, 0.052, 0, -0.085, 0.138, grip);
      box("stock", 0.048, 0.037, 0.16, 0, 0.057, -0.125, grip);
      box("stock-pad", 0.063, 0.108, 0.024, 0, 0.01, -0.206, grip);
      box("foregrip", 0.05, 0.058, 0.115, 0, -0.011, 0.24, grip);
      box("top-rail", 0.035, 0.018, 0.22, 0, 0.106, 0.081, grip);
      box("rear-sight", 0.042, 0.03, 0.023, 0, 0.12, -0.01, detail);
      box("front-sight", 0.02, 0.034, 0.016, 0, 0.105, 0.289, detail);
      for (let i = 0; i < 5; i++)
        box("heat-vent", 0.073, 0.012, 0.017, 0, 0.064, 0.13 + i * 0.02, grip);
    } else {
      const shell = MeshBuilder.CreateSphere(
        "grenade-shell",
        { diameter: 0.075, segments: 8 },
        this.scene,
      );
      shell.scaling.y = 1.25;
      shell.material = material("olive-shell", "#536348", 0.3);
      pieces.push(shell);
      box("grenade-fuse", 0.024, 0.026, 0.025, 0, 0.052, 0, detail);
      box("grenade-lever", 0.01, 0.075, 0.009, 0.031, 0.024, 0);
      for (let i = 0; i < 3; i++)
        cylinder(
          "shell-groove",
          0.079,
          0.004,
          0,
          -0.028 + i * 0.026,
          0,
          grip,
        ).rotation.x = 0;
    }
    // Each weapon uses one merged mesh with submeshes for the small shared material set.
    const merged = Mesh.MergeMeshes(pieces, true, true, undefined, false, true);
    if (merged) {
      this.mergedMaterial = merged.material;
      merged.parent = root;
      merged.isPickable = false;
      merged.metadata = { weaponVisual: true };
    }
    root.metadata = { weaponVisual: true };
    root.isPickable = false;
    const hand = character.skeleton.bones.find((bone) =>
      bone.name.endsWith("/rightHand"),
    );
    if (hand) root.attachToBone(hand, character.torso);
    else root.parent = character.root;
  }
  private disposeModel() {
    if (this.root && !this.root.isDisposed()) this.root.dispose();
    if (
      this.mergedMaterial &&
      !this.materials.includes(this.mergedMaterial as PBRMaterial)
    )
      this.mergedMaterial.dispose();
    this.mergedMaterial = null;
    for (const material of this.materials) material.dispose();
    this.materials = [];
    this.root = null;
  }
  dispose(): void {
    this.disposeModel();
    this.owner = null;
  }
}
