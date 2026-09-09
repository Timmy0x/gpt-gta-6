import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import HavokPhysics from "@babylonjs/havok";
import { DirectionalLight, HavokPlugin, Material, NullEngine, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2 } from "@babylonjs/core";
import type { WorldManifest } from "../src/world/packages";
import { World } from "../src/world/World";
import { DamageSystem } from "../src/gameplay/Damage";

test("production export gives every lamp and palm disjoint exact geometry ranges inside shared native chunk batches", async t => {
  const raw = await readFile(new URL("../public/world/manifest.json", import.meta.url));
  const manifest = JSON.parse(raw.toString()) as WorldManifest;
  assert.equal(manifest.build, "authored-860409-v8-street-objects");
  const objects = manifest.streetObjects!;
  assert.equal(objects.length, 555); assert.equal(objects.filter(o => o.kind === "lamppost").length, 264);
  assert.equal(new Set(objects.map(o => o.id)).size, objects.length);
  assert.ok(objects.filter(o => o.position[0] < -570).length > 100, "western streets are included");
  const batches = new Map<string, { positions: number[]; indices: number[] }>();
  for (const chunk of manifest.chunks) {
    const data = JSON.parse(gunzipSync(await readFile(new URL(`../public/world/${chunk.url}`, import.meta.url))).toString());
    for (const mesh of data.meshes.filter((m: { metadata?: { streetBatch?: boolean } }) => m.metadata?.streetBatch))
      batches.set(mesh.id, data.geometries.vertexData.find((g: { id: string }) => g.id === mesh.geometryId));
  }
  assert.equal(batches.size, 350);
  for (const object of objects) {
    assert.ok(object.shapes.length > 0 && object.visuals!.length > 1);
    assert.ok(object.shapes.every(s => s.size.every(n => Number.isFinite(n) && n > 0)));
    for (const range of object.visuals!) assert.ok(batches.has(range.batch), `resident source for ${object.id}`);
  }
  for (const [id, geometry] of batches) {
    const ranges = objects.flatMap(o => o.visuals!.filter(r => r.batch === id)).sort((a, b) => a.vertexStart - b.vertexStart);
    let vertex = 0, index = 0;
    for (const range of ranges) {
      assert.equal(range.vertexStart, vertex); assert.equal(range.indexStart, index);
      assert.ok(geometry.indices.slice(index, index + range.indexCount).every(i => i >= vertex && i < vertex + range.vertexCount), "triangles cannot address a neighbor object's vertices");
      vertex += range.vertexCount; index += range.indexCount;
    }
    assert.equal(vertex * 3, geometry.positions.length); assert.equal(index, geometry.indices.length);
  }
  t.diagnostic(JSON.stringify({ objects: objects.length, batches: batches.size, children: objects.reduce((n, o) => n + o.shapes.length, 0), manifestBytes: raw.length, manifestGzipBytes: gzipSync(raw).length, ...manifest.totals }));
});

test("production native packages extract the actual lamp, preserve damage across travel, and release all physics/render resources", async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "name"); Object.defineProperty(globalThis, "name", { value: "", configurable: true });
  const bytes = await readFile(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine); scene.defaultMaterial = new Material("export-test/no-shader", scene);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(16, new DirectionalLight("sun", Vector3.Down(), scene));
  const fileFetch: typeof fetch = async input => new Response(await readFile(new URL(`../public${new URL(String(input)).pathname}`, import.meta.url)) as BodyInit);
  const world = new World({ scene, shadows }, { baseUrl: "http://world.test/world/", fetch: fileFetch });
  const damage = new DamageSystem(scene, shadows, world, false);
  try {
    await world.ready;
    const lamp = [...world.streetObjects.objects.values()].filter(o => o.definition.kind === "lamppost" && o.body && o.definition.meshes.every(id => scene.getMeshById(id))).sort((a, b) => Vector3.DistanceSquared(a.position, world.spawn) - Vector3.DistanceSquared(b.position, world.spawn))[0];
    assert.ok(lamp);
    const initial = { ...world.streetObjects.getStats(), meshes: scene.meshes.length, geometries: scene.geometries.length, bodies: physics.getBodies().length };
    assert.equal(world.getStreamingStats().totalColliders, 730 + 555);
    assert.equal(world.getStreamingStats().residentColliders, physics.getBodies().length);
    assert.equal(world.getStreamingStats().streetObjects!.indexBackupBytes, initial.indexBackupBytes);
    const source = lamp.definition.meshes.map(id => scene.getMeshById(id)!);
    damage.hitStreetObject(lamp, 500, lamp.position.add(new Vector3(0, 1, 0)), "impact", new Vector3(0, 0, 1));
    const started = performance.now();
    for (let i = 0; i < 360; i++) { damage.update(1 / 60, "Clear"); physics._step(1 / 60); scene.onAfterPhysicsObservable.notifyObservers(scene); }
    const physicsMs = performance.now() - started;
    assert.ok(lamp.fallen && lamp.parts.size === lamp.definition.visuals!.length);
    assert.ok(Math.abs(lamp.rotation.x) + Math.abs(lamp.rotation.z) > .3, "production metal stem falls under Havok");
    const pose = lamp.position.clone(), rotation = lamp.rotation.clone(), saved = JSON.parse(JSON.stringify(world.streetObjects.serialize()));
    const west = new Vector3(-900, 1, 0); await world.preparePosition(west);
    for (let i = 0; i < 24; i++) { world.update(1 / 60, west, 15, "Clear"); physics._step(1 / 60); scene.onAfterPhysicsObservable.notifyObservers(scene); }
    assert.equal(lamp.body, undefined); assert.ok(source.every(m => m.isDisposed())); assert.equal(lamp.parts.size, 0);
    assert.ok(lamp.position.equalsWithEpsilon(pose, .001), "support eviction cannot make a settled remote pole fall before its body unloads");
    await world.preparePosition(world.spawn); world.streetObjects.restore(saved);
    assert.ok(lamp.body && lamp.fallen && lamp.parts.size > 0);
    assert.ok(lamp.position.equalsWithEpsilon(pose, .001) && lamp.rotation.equalsWithEpsilon(rotation, .001));
    assert.ok(source.every(m => m.isDisposed()), "reload uses new native buffers, not retained originals");
    t.diagnostic(JSON.stringify({ initial, afterReload: world.streetObjects.getStats(), simulatedSteps: 360, nullEnginePhysicsAndDamageMs: physicsMs, savedBytes: JSON.stringify(saved).length, lamp: lamp.definition.id }));
    damage.dispose(); world.dispose();
    assert.equal(physics.getBodies().length, 0); assert.equal(scene.meshes.length, 0); assert.equal(scene.geometries.length, 0); assert.equal(shadows.getShadowMap()!.renderList!.length, 0);
  } finally {
    damage.dispose(); world.dispose(); shadows.dispose(); scene.dispose(); engine.dispose();
    if (descriptor) Object.defineProperty(globalThis, "name", descriptor); else Reflect.deleteProperty(globalThis, "name");
  }
});
