import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import HavokPhysics from "@babylonjs/havok";
import {
  DirectionalLight,
  FreeCamera,
  HavokPlugin,
  MeshBuilder,
  NullEngine,
  PhysicsAggregate,
  PhysicsShapeType,
  Scene,
  ShadowGenerator,
  Vector3,
  VertexBuffer,
  type PhysicsEngineV2,
} from "@babylonjs/core";
import { WeaponInventory, HeldWeapon } from "../src/gameplay/combat/Weapons";
import {
  castSegment,
  muzzleShot,
  obstructed,
} from "../src/gameplay/combat/queries";
import { ProjectileSystem } from "../src/gameplay/combat/Projectiles";
import { DamageSystem } from "../src/gameplay/Damage";
import { RagdollReactions } from "../src/gameplay/combat/RagdollReactions";
import { Character } from "../src/gameplay/Character";
import type { WorldContract } from "../src/core/contracts";

const binary = await readFile(
  new URL(
    "../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm",
    import.meta.url,
  ),
);
const havok = await HavokPhysics({
  wasmBinary: binary.buffer.slice(
    binary.byteOffset,
    binary.byteOffset + binary.byteLength,
  ) as ArrayBuffer,
});
function fixture() {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2,
    shadows = new ShadowGenerator(
      64,
      new DirectionalLight("sun", new Vector3(0, -1, 0), scene),
    );
  scene.activeCamera = new FreeCamera("test", new Vector3(0, 4, -8), scene);
  const box = (
    name: string,
    position: Vector3,
    width = 1,
    height = 1,
    depth = 1,
  ) => {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.copyFrom(position);
    mesh.computeWorldMatrix(true);
    new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 0 }, scene);
    return mesh;
  };
  box("ground", new Vector3(0, -0.5, 0), 100, 1, 100);
  const world: WorldContract = {
    spawn: Vector3.Zero(),
    obstacles: [],
    roads: [],
    locations: [],
    waterLevel: -1,
    update() {},
    dispose() {},
  };
  const step = (count: number, update: (dt: number) => void = () => {}) => {
    for (let i = 0; i < count; i++) {
      update(1 / 60);
      physics._step(1 / 60);
      scene.onBeforeRenderObservable.notifyObservers(scene);
    }
  };
  return {
    scene,
    physics,
    shadows,
    world,
    box,
    step,
    dispose() {
      scene.dispose();
      engine.dispose();
    },
  };
}

test("weapon switching conserves rounds and reloading transfers only available reserve", () => {
  const inventory = new WeaponInventory();
  for (let i = 0; i < 5; i++) assert.ok(inventory.consume());
  assert.equal(inventory.ammo, 7);
  inventory.select(1);
  inventory.consume();
  inventory.select(0);
  assert.equal(inventory.ammo, 7);
  inventory.reserve = 3;
  assert.ok(inventory.reload());
  inventory.update(0.7);
  assert.equal(inventory.ammo, 7);
  assert.equal(inventory.consume(), false);
  inventory.update(1);
  assert.equal(inventory.ammo, 10);
  assert.equal(inventory.reserve, 0);
  inventory.ammo = 0;
  inventory.unlimited = true;
  assert.ok(inventory.consume());
  assert.equal(inventory.ammo, 0);
  assert.equal(inventory.select(99), false);
});

test("reticle sees target but muzzle ray stops at close cover, including invisible Havok proxies", () => {
  const f = fixture();
  try {
    const target = f.box("target", new Vector3(0, 1, 8), 1, 2, 1),
      cover = f.box("cover", new Vector3(0.75, 1, 1.2), 0.8, 2, 0.2);
    cover.isPickable = false;
    cover.isVisible = false;
    const result = muzzleShot(
      f.scene,
      new Vector3(0, 1, -2),
      Vector3.Forward(),
      new Vector3(0.75, 1, 0),
      30,
    );
    assert.equal(result.hit?.mesh, cover);
    assert.ok(result.target.z > 7);
    assert.ok(result.end.z < 1.4);
    assert.ok(
      obstructed(f.scene, new Vector3(0.75, 1, 0), new Vector3(0.75, 1, 3)),
    );
    assert.equal(
      obstructed(f.scene, new Vector3(0.75, 3, 0), new Vector3(0.75, 3, 3)),
      false,
    );
    assert.equal(
      castSegment(f.scene, new Vector3(0, 1, 0), new Vector3(0, 1, 10))?.mesh,
      target,
    );
  } finally {
    f.dispose();
  }
});

test("physical grenade follows gravity, bounces off a thin wall and detonates at its actual body position", () => {
  const f = fixture(),
    projectiles = new ProjectileSystem(f.scene);
  try {
    f.box("wall", new Vector3(0, 2, 4), 8, 4, 0.12);
    let detonation: Vector3 | null = null;
    projectiles.onDetonate = (position) => {
      detonation = position;
    };
    const grenade = projectiles.throw(
      new Vector3(0, 1.6, 0),
      new Vector3(0, 5, 18),
      1.5,
    );
    f.step(8, (dt) => projectiles.update(dt));
    assert.ok(grenade.mesh.position.y > 1.9, "throw has an upward arc");
    f.step(42, (dt) => projectiles.update(dt));
    assert.ok(grenade.mesh.position.z < 4, "wall prevents tunneling");
    const actual = grenade.mesh.position.clone();
    f.step(41, (dt) => projectiles.update(dt));
    assert.ok(detonation);
    assert.equal(projectiles.grenades.length, 0);
    assert.ok((detonation as Vector3).z < 4);
    assert.ok((detonation as Vector3).y < actual.y + 1);
  } finally {
    projectiles.dispose();
    f.dispose();
  }
});

test("destructible fences collide and obstruct navigation until broken; material damage differs", () => {
  const f = fixture(),
    damage = new DamageSystem(f.scene, f.shadows, f.world, false);
  try {
    const fence = damage.spawnBarrier(new Vector3(0, 0, 2));
    assert.equal(f.world.obstacles.length, 1);
    assert.ok(obstructed(f.scene, new Vector3(0, 1, 0), new Vector3(0, 1, 4)));
    damage.hit(
      fence,
      300,
      new Vector3(0, 1, 1.9),
      "projectile",
      Vector3.Forward(),
    );
    assert.equal(fence.health, 0);
    assert.equal(f.world.obstacles.length, 0);
    assert.equal(
      obstructed(f.scene, new Vector3(0, 1, 0), new Vector3(0, 1, 4)),
      false,
    );
    assert.ok(damage.debris.length > 5);
    const glass = damage.spawn(new Vector3(4, 0.55, 0), "glass"),
      metal = damage.spawn(new Vector3(8, 0.55, 0), "metal");
    damage.hit(glass, 32, glass.mesh.position, "projectile");
    damage.hit(metal, 32, metal.mesh.position, "projectile");
    assert.equal(glass.health, 0);
    assert.ok(metal.health > 110);
    f.step(860, (dt) => damage.update(dt, "Clear"));
    assert.equal(damage.debris.length, 0);
  } finally {
    damage.dispose();
    f.dispose();
  }
});

test("explosion cover is resolved in three dimensions before destruction changes the scene", () => {
  const f = fixture(),
    damage = new DamageSystem(f.scene, f.shadows, f.world, false);
  try {
    const barrier = damage.spawnBarrier(new Vector3(0, 0, 2), "gate", "wood");
    const shielded = damage.spawn(new Vector3(0, 0.55, 4), "wood"),
      exposed = damage.spawn(new Vector3(4, 0.55, 4), "wood");
    const health = shielded.health;
    damage.explosion(new Vector3(0, 0.9, 0));
    assert.equal(barrier.health, 0);
    assert.equal(shielded.health, health);
    assert.ok(exposed.health < health);
    damage.explosion(new Vector3(0, 0.9, 0));
    assert.ok(shielded.health < health, "second blast now passes broken gate");
  } finally {
    damage.dispose();
    f.dispose();
  }
});

test("fire has visible flames, causes material damage, extinguishes in rain and preserves deformed geometry on save", () => {
  const f = fixture(),
    damage = new DamageSystem(f.scene, f.shadows, f.world, false);
  try {
    const prop = damage.spawnBarrier(new Vector3(0, 0, 2), "gate");
    const before = Array.from(
      prop.parts[0].getVerticesData(VertexBuffer.PositionKind)!,
    );
    damage.hit(
      prop,
      12,
      new Vector3(0.1, 0.9, 1.91),
      "projectile",
      Vector3.Forward(),
    );
    const deformed = Array.from(
      prop.parts[0].getVerticesData(VertexBuffer.PositionKind)!,
    );
    assert.notDeepEqual(deformed, before);
    assert.ok(damage.ignite(prop, 5));
    damage.update(0.5, "Clear");
    assert.ok(damage.fire.active.size === 1);
    assert.ok(
      f.scene.meshes.some(
        (mesh) => mesh.name.startsWith("fire/") && mesh.isEnabled(),
      ),
    );
    const state = JSON.parse(JSON.stringify(damage.serialize())),
      health = prop.health;
    damage.restoreState(state);
    const restored = damage.props[0];
    assert.equal(restored.kind, "gate");
    assert.equal(restored.health, health);
    assert.deepEqual(
      Array.from(restored.parts[0].getVerticesData(VertexBuffer.PositionKind)!),
      deformed,
    );
    damage.update(1, "Rain");
    assert.equal(restored.burning, 0);
    assert.equal(damage.fire.active.size, 0);
    damage.ignite(restored);
    damage.extinguish(restored);
    assert.equal(damage.fire.active.size, 0);
    const glass = damage.spawn(new Vector3(5, 0.55, 0), "glass");
    assert.equal(damage.ignite(glass), false);
  } finally {
    damage.dispose();
    f.dispose();
  }
});

test("Babylon V2 ragdoll uses constrained bodies, physically falls, then safely returns the live rig to animation", () => {
  const f = fixture(),
    model = new Character(f.scene, f.shadows, "reaction"),
    reactions = new RagdollReactions(f.scene);
  try {
    model.root.position.y = 0.05;
    model.animate(1 / 60, 0);
    const bodyCount = f.physics.getBodies().length;
    reactions.hit(model, new Vector3(45, 12, 20));
    assert.equal(f.physics.getBodies().length, bodyCount + 11);
    assert.equal(reactions.active[0].ragdoll.getConstraints().length, 10);
    const pelvis = reactions.active[0].ragdoll.getAggregate(0).transformNode,
      start = pelvis.position.clone();
    f.step(100, (dt) => reactions.update(dt));
    assert.ok(Vector3.Distance(pelvis.position, start) > 0.25);
    assert.ok(pelvis.position.y < 0.8, "body settles near ground");
    assert.ok(model.root.metadata.ragdollActive);
    f.step(140, (dt) => reactions.update(dt));
    assert.equal(reactions.active.length, 0);
    assert.equal(f.physics.getBodies().length, bodyCount);
    assert.equal(model.root.metadata.ragdollActive, false);
    assert.ok(model.root.position.y >= 0 && model.root.position.y < 0.1);
    assert.ok(
      model.skeleton.bones.every((bone) =>
        bone.getPosition().asArray().every(Number.isFinite),
      ),
    );
  } finally {
    reactions.dispose();
    model.dispose();
    f.dispose();
  }
});

test("held models follow the skinned hand, hide for traversal and release pooled submaterials when switching", () => {
  const f = fixture(),
    model = new Character(f.scene, f.shadows, "armed"),
    held = new HeldWeapon(f.scene);
  try {
    const initial = f.scene.materials.length;
    model.animate(0.2, 0, true);
    held.update(model, 0, true, 0.1);
    const start = held.muzzle();
    model.root.position.x = 5;
    model.root.computeWorldMatrix(true);
    held.update(model, 0, true, 0.1);
    assert.ok(Math.abs(held.muzzle().x - start.x - 5) < 0.01);
    for (let i = 0; i < 24; i++) held.update(model, i % 3, true, 0.1);
    assert.ok(f.scene.materials.length <= initial + 5);
    held.update(model, 0, false, 0.1);
    assert.equal(held.root!.isEnabled(), false);
    held.dispose();
    assert.equal(f.scene.materials.length, initial);
  } finally {
    held.dispose();
    model.dispose();
    f.dispose();
  }
});

test("fatal hit during recovery reactivates physics and bounded ragdolls release disposal observers", () => {
  const f = fixture(),
    model = new Character(f.scene, f.shadows, "repeat-reaction"),
    reactions = new RagdollReactions(f.scene);
  try {
    const observers = model.root.onDisposeObservable.observers.length,
      baseline = f.physics.getBodies().length;
    reactions.hit(model, new Vector3(20, 3, 0));
    f.step(168, (dt) => reactions.update(dt));
    assert.ok(reactions.active[0].recovering);
    reactions.hit(model, new Vector3(30, 5, 0), true);
    assert.equal(reactions.active[0].recovering, false);
    assert.equal(reactions.active[0].fatal, true);
    assert.equal(f.physics.getBodies().length, baseline + 11);
    f.step(510, (dt) => reactions.update(dt));
    assert.equal(f.physics.getBodies().length, baseline);
    assert.equal(model.root.metadata.ragdollActive, true);
    assert.equal(
      model.root.onDisposeObservable.observers.filter(
        (observer) => !observer._willBeUnregistered,
      ).length,
      observers,
    );
  } finally {
    reactions.dispose();
    model.dispose();
    f.dispose();
  }
});

test("vehicle-like impacts queue prop destruction outside the physics callback and disposal restores resource counts", () => {
  const f = fixture(),
    damage = new DamageSystem(f.scene, f.shadows, f.world, false);
  try {
    const baseBodies = f.physics.getBodies().length,
      baseMaterials = f.scene.materials.length;
    const fence = damage.spawnBarrier(new Vector3(0, 0, 2), "fence", "wood");
    const impactor = MeshBuilder.CreateBox("impactor", { size: 0.6 }, f.scene);
    impactor.position.set(0, 0.8, -2);
    const body = new PhysicsAggregate(
      impactor,
      PhysicsShapeType.BOX,
      { mass: 800 },
      f.scene,
    );
    body.body.setLinearVelocity(new Vector3(0, 0, 25));
    f.step(20, (dt) => damage.update(dt, "Clear"));
    assert.equal(fence.health, 0);
    assert.ok(damage.debris.length > 0);
    damage.remove(fence);
    body.dispose();
    impactor.dispose();
    assert.equal(f.physics.getBodies().length, baseBodies);
    assert.equal(f.scene.materials.length, baseMaterials);
  } finally {
    damage.dispose();
    f.dispose();
  }
});

test("Combat fire and melee use the normal public interfaces, dispatch officer impacts and spend ammunition", async () => {
  const { Combat } = await import("../src/gameplay/Combat");
  const f = fixture(),
    damage = new DamageSystem(f.scene, f.shadows, f.world, false),
    model = new Character(f.scene, f.shadows, "player");
  const camera = f.scene.activeCamera as FreeCamera;
  camera.position.set(0, 1.3, -3);
  camera.setTarget(new Vector3(0, 1.3, 5));
  camera.getViewMatrix(true);
  let received = 0,
    resistance = 0;
  const officer = { health: 100 };
  const target = MeshBuilder.CreateBox(
    "officer-target",
    { width: 0.6, height: 1.8, depth: 0.4 },
    f.scene,
  );
  target.position.set(0, 0.9, 5);
  target.metadata = { officer };
  target.computeWorldMatrix(true);
  const player = {
    model,
    camera,
    position: new Vector3(0, 0.9, 0),
    input: { mouseDown: false },
    deadTimer: 0,
    vehicle: null,
    transitioning: false,
    pitch: 0,
    controller: { getVelocity: () => Vector3.Zero() },
    hurt() {},
  };
  const population = {
    pedestrians: [],
    officers: [],
    onCharacterHit: null,
    resist() {
      resistance++;
    },
    frighten() {},
    witness() {
      return false;
    },
    hurtOfficer(_officer: unknown, amount: number) {
      received += amount;
    },
    hurtPed() {},
  };
  const combat = new Combat(
    f.scene,
    player as unknown as import("../src/gameplay/Player").Player,
    population as unknown as import("../src/gameplay/Population").Population,
    damage,
    {
      list: [],
    } as unknown as import("../src/vehicles/VehicleSystem").VehicleSystem,
    { crime() {} } as unknown as import("../src/gameplay/Wanted").WantedSystem,
  );
  try {
    model.animate(0.2, 0, true);
    combat.fire();
    assert.equal(combat.ammo, 11);
    assert.equal(received, 32);
    assert.equal(resistance, 1);
    combat.fire();
    assert.equal(
      combat.ammo,
      11,
      "cooldown suppresses repeated immediate fire",
    );
    target.position.z = 1.1;
    target.computeWorldMatrix(true);
    combat.cooldown = 0;
    assert.ok(combat.melee());
    assert.equal(received, 67);
    assert.equal(combat.ammo, 11);
    player.input.mouseDown = true;
    combat.cooldown = 0;
    let detonations = 0;
    combat.projectiles.onDetonate = () => { detonations++; };
    combat.projectiles.throw(new Vector3(5, 2, 0), Vector3.Zero(), .15);
    for (let frame = 0; frame < 12; frame++) combat.update(1 / 60, false);
    assert.equal(combat.ammo, 11, "overlay suppresses held fire input");
    assert.equal(detonations, 1, "autonomous grenade fuse continues behind overlay");
    player.input.mouseDown = false;
    player.transitioning = true;
    combat.update(0.1);
    assert.equal(combat.held.root!.isEnabled(), false);
    combat.cooldown = 0;
    combat.fire();
    assert.equal(combat.ammo, 11);
  } finally {
    combat.dispose();
    damage.dispose();
    model.dispose();
    f.dispose();
  }
});

test('reset clears active, fatal and already-settled ragdolls before population respawn',()=>{
  const f=fixture(),reactions=new RagdollReactions(f.scene),models=[0,1,2].map(i=>new Character(f.scene,f.shadows,'reset-'+i));
  try {
    models.forEach((model,i)=>{model.root.position.x=i*3;model.animate(.1,0);});const baseline=f.physics.getBodies().length;
    reactions.hit(models[0],new Vector3(10,3,0),true);f.step(490,dt=>reactions.update(dt));assert.equal(reactions.active.length,0);assert.equal(models[0].root.metadata.ragdollActive,true);
    reactions.hit(models[1],new Vector3(10,3,0),true);reactions.hit(models[2],new Vector3(10,3,0),false);f.step(10,dt=>reactions.update(dt));assert.equal(reactions.active.length,2);
    reactions.reset();assert.equal(reactions.active.length,0);assert.equal(f.physics.getBodies().length,baseline);for(const model of models){assert.equal(model.root.metadata.ragdollActive,false);assert.equal(model.root.metadata.ragdollRecovering,false);assert.ok(model.skeleton.bones[0].getPosition().y>.9);}
  }finally{reactions.dispose();for(const model of models)model.dispose();f.dispose();}
});
