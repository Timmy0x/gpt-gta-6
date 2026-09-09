import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import HavokPhysics from "@babylonjs/havok";
import { HavokPlugin, Mesh, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsBody, PhysicsCharacterController, PhysicsMotionType, PhysicsShapeBox, PhysicsShapeCapsule, PhysicsShapeType, Quaternion, Scene, Vector3, type PhysicsEngineV2 } from "@babylonjs/core";
import { castSegment, muzzleShot } from "../src/gameplay/combat/queries";

async function fixture() {
  const bytes = await readFile(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  return { scene, physics: scene.getPhysicsEngine() as PhysicsEngineV2, dispose() { scene.dispose(); engine.dispose(); } };
}

test("normal reticle ray ignores its real character capsule before native collection and still stops at a thin pole or close cover", async t => {
  const f = await fixture(), cleanup = [() => f.dispose()]; t.after(() => cleanup.reverse().forEach(dispose => dispose()));
  const shape = new PhysicsShapeCapsule(new Vector3(0, -.58, 0), new Vector3(0, .58, 0), .34, f.scene);
  const controller = new PhysicsCharacterController(new Vector3(0, 1, 0), { shape }, f.scene); cleanup.push(() => { controller.dispose(); shape.dispose(); });
  const pole = MeshBuilder.CreateCylinder("physical pole", { height: 3, diameter: .15 }, f.scene); pole.position.set(0, 1.5, 8); pole.isPickable = false;
  const aggregate = new PhysicsAggregate(pole, PhysicsShapeType.CYLINDER, { mass: 0 }, f.scene); cleanup.push(() => aggregate.dispose());
  const camera = new Vector3(0, 1.5, -3), muzzle = new Vector3(.3, 1.45, .5);
  assert.equal(f.physics.raycast(camera, new Vector3(0, 1.5, 20)).body?.transformNode.name, "CCTransformNode", "reproduces the normal shoulder camera's first native hit");
  const options = { bodyFilter: (body: PhysicsBody) => body.transformNode.name !== "CCTransformNode" };
  const shot = muzzleShot(f.scene, camera, Vector3.Forward(), muzzle, 40, options);
  assert.equal(shot.hit?.body, aggregate.body, "excluded self must not hide the real pole behind it");
  assert.ok(Math.abs(shot.target.x) < .01 && shot.target.z < 8.01);
  const cover = MeshBuilder.CreateBox("close solid cover", { width: 2, height: 3, depth: .12 }, f.scene); cover.position.set(0, 1.5, 2); cover.isPickable = false;
  const wall = new PhysicsAggregate(cover, PhysicsShapeType.BOX, { mass: 0 }, f.scene); cleanup.push(() => wall.dispose());
  assert.equal(muzzleShot(f.scene, camera, Vector3.Forward(), muzzle, 40, options).hit?.body, wall.body, "real cover still stops the bullet before the pole");
});

test("many excluded bodies cannot saturate the collector or hide an allowed body sharing their shape", async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(1, 1, .4), f.scene);
  const bodies: PhysicsBody[] = [];
  t.after(() => { for (const body of bodies) body.dispose(); shape.dispose(); });
  for (let i = 0; i < 42; i++) {
    const root = new Mesh(`shared-shape-${i}`, f.scene); root.position.set(0, 1, 1 + i); root.isPickable = false;
    const body = new PhysicsBody(root, PhysicsMotionType.STATIC, false, f.scene); body.shape = shape; bodies.push(body);
  }
  const membership = shape.filterMembershipMask, collision = shape.filterCollideMask;
  const ignored = new Set(bodies.slice(0, 40));
  const hit = castSegment(f.scene, new Vector3(0, 1, -1), new Vector3(0, 1, 50), { bodies: ignored });
  assert.equal(hit?.body, bodies[40], "collector grows beyond32 omitted bodies and keeps the nearest allowed target");
  assert.equal(shape.filterMembershipMask, membership); assert.equal(shape.filterCollideMask, collision);
  assert.equal(f.physics.raycast(new Vector3(0, 1, -1), new Vector3(0, 1, 50)).body, bodies[0], "queries never change later real collisions or ordinary ray behavior");
});
