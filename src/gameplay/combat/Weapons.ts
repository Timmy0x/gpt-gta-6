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
import { instantiateWeaponAsset } from './WeaponAssets';

import { WEAPON_SPECS, validWeaponSave } from './WeaponCatalog';
export { WEAPON_SPECS } from './WeaponCatalog';

/** Persistent per-weapon magazines prevent free refills or discarded rounds when switching. */
export class WeaponInventory {
  selected = 0;
  magazines = WEAPON_SPECS.map(w => w.capacity);
  reserves = WEAPON_SPECS.map(w => w.reserve);
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
  restore(value: unknown): boolean {
    if (!validWeaponSave(value)) return false;
    this.magazines = WEAPON_SPECS.map((w, i) => value.magazines[i] ?? w.capacity);
    this.reserves = WEAPON_SPECS.map((w, i) => value.reserves[i] ?? w.reserve);
    this.selected = value.selected; this.reloadRemaining = 0;
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
    if (this.reloadRemaining > 0 || WEAPON_SPECS[this.selected].capacity === 0) return false;
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
  private side: -1 | 1 = 1;
  private moving: {mesh: Mesh; rest: Vector3; kind: string}[] = [];
  private mergedMaterial: Material | null = null;
  constructor(private scene: Scene) {}
  update(
    character: Character,
    index: number,
    visible: boolean,
    dt: number,
    reloading = false,
    side: -1 | 1 = 1,
    reloadProgress = 0,
  ): void {
    if (
      this.owner !== character || this.side !== side ||
      this.selected !== index ||
      !this.root ||
      this.root.isDisposed()
    )
      this.build(character, index, side);
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
    for (const part of this.moving) {
      part.mesh.position.copyFrom(part.rest);
      if (/slide|bolt|charginghandle/i.test(part.kind)) part.mesh.position.z -= this.kick * .028;
      if (/pump/i.test(part.kind)) part.mesh.position.z -= Math.sin(this.kick * Math.PI) * .085;
      if (/magazine/i.test(part.kind) && reloading) part.mesh.position.y -= Math.sin(Math.PI * reloadProgress) * .115;
    }
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
        WEAPON_SPECS[this.selected].muzzle,
      ),
      this.root.computeWorldMatrix(true),
    );
  }
  private build(character: Character, index: number, side: -1 | 1): void {
    this.disposeModel();
    this.owner = character;
    this.selected = index;
    this.side = side;
    const root = new Mesh("held-" + WEAPON_SPECS[index].name, this.scene);
    this.root = root;
    const imported = instantiateWeaponAsset(this.scene, index, root);
    if (imported) {
      this.moving = imported.filter(mesh => /slide|bolt|charginghandle|magazine/i.test(mesh.metadata?.part ?? '')).map(mesh => ({mesh, rest: mesh.position.clone(), kind: mesh.metadata.part}));
      root.metadata = {weaponVisual: true}; root.isPickable = false;
      this.attach(character, side); return;
    }
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
    } else if ([3, 4, 5].includes(index)) {
      const length = WEAPON_SPECS[index].muzzle;
      box("receiver", .065, .085, .26, 0, .058, .1);
      cylinder("barrel", index === 4 ? .037 : .027, length - .22, 0, .065, .22 + (length - .22) / 2);
      box("stock-neck", .048, .045, .18, 0, .04, -.13, grip);
      box("shoulder-stock", .064, .14, .16, 0, -.003, -.27, grip);
      box("rubber-butt", .075, .15, .018, 0, -.003, -.358, grip);
      box("pistol-grip", .05, .12, .067, 0, -.04, .005, grip).rotation.x = -.27;
      box("trigger-guard", .013, .055, .09, 0, -.012, .06);
      if (index === 4) {
        cylinder("magazine-tube", .029, .46, 0, .024, .38);
        cylinder("pump-foreend", .068, .16, 0, .032, .37, grip);
        for (let i = 0; i < 9; i++) cylinder("pump-groove", .071, .004, 0, .032, .304 + i * .017);
      } else {
        box("box-magazine", .044, index === 3 ? .17 : .066, .076, 0, -.055, .16, grip);
        box("handguard", .07, .067, index === 3 ? .28 : .38, 0, .05, index === 3 ? .34 : .4, grip);
        for (let i = 0; i < 9; i++) box("rail", .045, .015, .009, 0, .103, .18 + i * .023);
      }
      if (index === 5) {
        cylinder("scope-tube", .044, .32, 0, .16, .13);
        cylinder("objective", .07, .09, 0, .16, .31);
        cylinder("ocular", .055, .045, 0, .16, -.051);
        cylinder("scope-lens", .06, .006, 0, .16, .36, detail);
        box("scope-mount-front", .055, .045, .02, 0, .114, .21);
        box("scope-mount-rear", .055, .045, .02, 0, .114, .02);
      } else { box("rear-sight", .035, .023, .018, 0, .117, -.02); box("front-sight", .01, .028, .016, 0, .102, length - .045); }
    } else if (index === 6) {
      box("revolver-frame", .048, .068, .13, 0, .054, .004);
      cylinder("six-round-cylinder", .062, .062, 0, .058, .025);
      cylinder("heavy-barrel", .034, .21, 0, .065, .179);
      box("barrel-rib", .032, .015, .22, 0, .082, .18);
      box("wood-grip", .05, .115, .077, 0, -.026, -.037, grip).rotation.x = -.27;
      box("hammer", .018, .026, .027, 0, .082, -.069);
      box("front-sight", .008, .018, .02, 0, .102, .27, detail);
    } else if (index === 2) {
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
    if (index === 1) for (const piece of pieces) { piece.position.z *= .67; piece.scaling.z *= .67; }
    // Each weapon uses one merged mesh with submeshes for the small shared material set.
    const moving = pieces.filter(mesh => /^(?:magazine|pump-foreend|pump-groove)$/.test(mesh.name));
    for (const mesh of moving) {mesh.parent = root; mesh.isPickable = false; mesh.metadata = {weaponVisual: true};}
    this.moving = moving.map(mesh => ({mesh, rest: mesh.position.clone(), kind: mesh.name}));
    const fixed = pieces.filter(mesh => !moving.includes(mesh));
    const merged = fixed.length ? Mesh.MergeMeshes(fixed, true, true, undefined, false, true) : null;
    if (merged) {
      this.mergedMaterial = merged.material;
      merged.parent = root;
      merged.isPickable = false;
      merged.metadata = { weaponVisual: true };
    }
    root.metadata = { weaponVisual: true };
    root.isPickable = false;
    this.attach(character, side);
  }
  private attach(character: Character, side: -1 | 1) {
    const root = this.root!;
    const hand = character.skeleton.bones.find((bone) =>
      bone.name.endsWith(side < 0 ? "/leftHand" : "/rightHand"),
    );
    if (hand) root.attachToBone(hand, character.torso);
    else root.parent = character.root;
  }
  private disposeModel() {
    this.moving = [];
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
