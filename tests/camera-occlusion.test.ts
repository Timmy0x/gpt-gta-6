import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, Matrix, Mesh, MeshBuilder, NullEngine, PhysicsEngineV2, Ray, Scene, ShadowGenerator, TransformNode, Vector3, VertexData } from '@babylonjs/core';
import { CameraOcclusion } from '../src/core/CameraOcclusion';
import { CameraMeshQueries } from '../src/core/CameraMeshQueries';
import type { Input } from '../src/core/Input';
import { Player } from '../src/gameplay/Player';

function fixture(t: test.TestContext) {
  const engine = new NullEngine(), scene = new Scene(engine), camera = new CameraOcclusion(scene);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const target = new Vector3(0, -20, 0), desired = target.add(new Vector3(0, 0, -5));
  function wall(name: string, z: number, x = 0, width = 8, depth = .2) {
    const mesh = MeshBuilder.CreateBox(name, { width, height: 8, depth }, scene);
    mesh.position.set(x, target.y, z); mesh.metadata = { cameraBlocker: true }; mesh.computeWorldMatrix(true);
    return mesh;
  }
  return { engine, scene, camera, target, desired, wall };
}

test('camera selects the nearest wall at Miami negative elevations and leaves near-plane clearance', t => {
  const { camera, target, desired, wall } = fixture(t);
  wall('far-inserted-first', -4); wall('nearest', -2);
  const position = camera.resolve(target, desired, desired, 1 / 60);
  assert.ok(position.z >= -1.680001 && position.z < -1.65, `${position.asArray()}`);
  assert.equal(position.y, -20);
});

test('a newly appearing wall retracts the camera immediately despite positional smoothing', t => {
  const { camera, target, desired, wall } = fixture(t);
  camera.resolve(target, desired, desired, 1 / 60);
  wall('new-surface', -2);
  const position = camera.resolve(target, desired, desired, 1 / 60);
  assert.ok(position.z >= -1.680001, 'interpolation must not leave the camera on the far side');
});

test('the camera recovers when its previous position is inside a thick wall', t => {
  const { camera, target, desired, wall } = fixture(t);
  camera.resolve(target, desired, desired, 1 / 60);
  const enclosingCamera = wall('thick-wall', -4, 0, 8, 1);
  const position = camera.resolve(target, desired, new Vector3(0, -20, -4), 1 / 60);
  assert.ok(position.z >= -3.280001, `${position.asArray()}`);
  assert.equal(enclosingCamera.getBoundingInfo().boundingBox.intersectsPoint(position), false);
});

test('off-axis camera clearance detects a narrow obstacle missed by the center ray', t => {
  const { scene, camera, target, desired, wall } = fixture(t);
  const obstacle = wall('off-axis', -2, .22, .1);
  assert.equal(scene.pickWithRay(new Ray(target, new Vector3(0, 0, -1), 5), mesh => mesh === obstacle)?.hit, false);
  assert.ok(camera.resolve(target, desired, desired, 1 / 60).z >= -1.680001);
});

test('short endpoint probes create side clearance beside a parallel wall', t => {
  const { camera, target, desired, wall } = fixture(t);
  const side = wall('parallel-wall', -2.5, .15, .04, 12);
  const position = camera.resolve(target, desired, desired, 1 / 60);
  assert.ok(position.x <= -.05999, `${position.asArray()}`);
  assert.equal(side.getBoundingInfo().boundingBox.intersectsPoint(position), false);
  assert.ok(.13 - position.x >= .18999, 'near-plane width and 8 cm margin plus numerical skin');
});

test('rendered tile geometry blocks only the camera and creates no physical world data', t => {
  const { scene, camera, target, desired, wall } = fixture(t);
  const placement = new TransformNode('lh-tile-placement', scene), importedRoot = new TransformNode('glTF-root', scene);
  importedRoot.parent = placement;
  const visual = wall('visual-only', -2); visual.metadata = null; visual.parent = importedRoot;
  assert.equal(scene.getPhysicsEngine(), null);
  assert.ok(camera.resolve(target, desired, desired, 1 / 60).z >= -1.680001);
  assert.equal(scene.getPhysicsEngine(), null);
  placement.setEnabled(false);
  assert.ok(camera.resolve(target, desired, desired, 1 / 60).equals(desired), 'cached but disabled tile LOD must not block');
  placement.setEnabled(true); visual.isVisible = false;
  assert.ok(camera.resolve(target, desired, desired, 1 / 60).equals(desired), 'non-rendered source meshes must not block');
  visual.isVisible = true; visual.visibility = 0;
  assert.ok(camera.resolve(target, desired, desired, 1 / 60).equals(desired));
  visual.visibility = 1;
  assert.ok(camera.resolve(target, desired, desired, 1 / 60).z >= -1.680001);
});

test('invisible public collision and transformed visual surfaces retain their camera queries', t => {
  const { scene, camera, target, desired, wall } = fixture(t);
  const hidden = wall('invisible-public', -2); hidden.isVisible = false;
  assert.ok(camera.resolve(target, desired, desired, 1 / 60).z >= -1.680001);
  hidden.dispose();
  const placement = new TransformNode('lh-tile-placement', scene);
  // A rigid source placement belongs to the existing metre frame, including negative ground Y.
  placement.position.set(0, -20, -2); placement.rotation.y = Math.PI / 4;
  const visual = wall('transformed-visual', 0); visual.metadata = null; visual.position.setAll(0); visual.parent = placement;
  const position = camera.resolve(target, desired, desired, 1 / 60);
  assert.ok(position.z > -2 && position.z < 0, `${position.asArray()}`);
  assert.equal(position.y, -20);
});

test('the controlled player and vehicle are excluded while unrelated scene blockers remain', t => {
  const { scene, camera, target, desired, wall } = fixture(t);
  const player = new TransformNode('controlled-player', scene), vehicle = new TransformNode('controlled-vehicle', scene);
  const ownBody = wall('own-body', -.1), ownRoof = wall('own-roof', -1); ownBody.parent = player; ownRoof.parent = vehicle;
  const position = camera.resolve(target, desired, desired, 1 / 60, { ignoredRoots: [player, vehicle] });
  assert.ok(position.equals(desired));
  wall('unrelated-building', -3);
  assert.ok(camera.resolve(target, desired, desired, 1 / 60, { ignoredRoots: [player, vehicle] }).z >= -2.680001);
});

test('a wider near plane increases clearance for ultrawide aspect ratios', t => {
  const { camera, target, desired, wall } = fixture(t);
  wall('wide-view-edge', -2, .31, .12);
  assert.ok(camera.resolve(target, desired, desired, 1 / 60, { aspect: 1 }).equals(desired));
  assert.ok(camera.resolve(target, desired, desired, 1 / 60, { aspect: 4 }).z >= -1.680001);
});

test('district teleport resolves the new camera locally without interpolating through the previous district', t => {
  const { camera, target, desired, wall } = fixture(t);
  camera.resolve(target, desired, desired, 1 / 60);
  wall('old-district', -2);
  const next = new Vector3(500, -24, -400), nextDesired = next.add(new Vector3(0, 0, -5));
  assert.ok(camera.resolve(next, nextDesired, desired, 1 / 60).equals(nextDesired));
});

test('camera probes never send far-away meshes to native triangle picking', t => {
  const { scene, camera, target, desired, wall } = fixture(t);
  for (let i = 0; i < 180; i++) {
    const distant = wall(`distant-${i}`, 100 + i, 200 + i);
    distant.intersects = () => { throw new Error('far-away triangle query'); };
  }
  const nearby = wall('nearby', -2);
  let calls = 0; const intersects = nearby.intersects.bind(nearby);
  nearby.intersects = (...args: Parameters<typeof nearby.intersects>) => { calls++; return intersects(...args); };
  scene.pickWithRay = () => { throw new Error('full-scene pick is unnecessary for non-thin meshes'); };
  assert.ok(camera.resolve(target, desired, desired, 1 / 60).z >= -1.680001);
  assert.equal(calls, 0, 'detached native query partitions avoid whole-mesh triangle scans');
});

test('public thin-instance blockers retain Babylon instance-aware nearest picking', t => {
  const { camera, target, desired, wall } = fixture(t);
  const instances = wall('thin-public', -2);
  instances.thinInstanceSetBuffer('matrix', new Float32Array([...Matrix.Identity().asArray(), ...Matrix.Translation(0, 0, -2).asArray()]), 16, true);
  instances.thinInstanceEnablePicking = true;
  assert.ok(camera.resolve(target, desired, desired, 1 / 60).z >= -1.680001);
});

test('actual Player.render applies visual camera avoidance while leaving Havok and character positions unchanged', async t => {
  const { scene, camera: _camera, engine, wall } = fixture(t);
  const bytes = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(128, new DirectionalLight('sun', Vector3.Down(), scene));
  const input = { aim: false, dx: 0, dy: 0, gamepad: null, down: () => false, take: () => false, axis: () => 0 } as unknown as Input;
  const player = new Player(scene, shadows, input, new Vector3(0, -21.06, 0));
  const placement = new TransformNode('lh-tile-placement', scene), visual = wall('render-only-obstacle', -2);
  visual.metadata = null; visual.parent = placement;
  const position = player.position.clone(), bodies = physics.getBodies().length;
  player.render(1 / 60);
  assert.ok(player.camera.position.z >= -1.69 && player.camera.position.z < 0, `${player.camera.position.asArray()}`);
  assert.ok(player.position.equals(position)); assert.equal(physics.getBodies().length, bodies);
  assert.ok(player.camera.getViewMatrix(true).asArray().every(Number.isFinite));
  for (const dt of [0, 1 / 240, 1 / 15, .2]) {
    player.camera.position.set(0, -20, -4); player.render(dt);
    assert.ok(player.camera.position.z >= -1.69, `immediate occlusion recovery at dt=${dt}`);
    assert.ok(player.position.equals(position));
  }
  player.controller.dispose(); player.queries.dispose(); shadows.dispose();
  assert.equal(engine.isDisposed, false);
});

test('exact clearance detects a 2 cm near-plane blocker between every finite boom ray', t => {
  const { camera, target, desired, wall } = fixture(t);
  const blocker = wall('between-rays', -4.88, .07, .02, .015); blocker.scaling.y = .0025;
  blocker.computeWorldMatrix(true);
  const position = camera.resolve(target, desired, desired, 1 / 60, { nearPlane: .12, fov: .88, aspect: 1.8 });
  assert.ok(!position.equals(desired), `${position.asArray()}`);
  const backward = position.subtract(target).normalize(), right = Vector3.Cross(Vector3.Up(), backward).normalize(), up = Vector3.Cross(backward, right).normalize();
  const halfHeight = .12 * Math.tan(.88 / 2), halfWidth = halfHeight * 1.8;
  // The native blocker may not intersect any point in the actual near-plane rectangle after recovery.
  for (let x = -10; x <= 10; x++) for (let y = -10; y <= 10; y++) {
    const nearPoint = position.subtract(backward.scale(.12)).add(right.scale(halfWidth * x / 10)).add(up.scale(halfHeight * y / 10));
    assert.equal(blocker.getBoundingInfo().boundingBox.intersectsPoint(nearPoint), false);
  }
});

test('non-indexed visual triangles and ordinary transformed instances retain native picking', t => {
  const { scene, camera, target, desired } = fixture(t);
  const placement = new TransformNode('lh-tile-placement', scene), mesh = new Mesh('non-indexed-source', scene), data = new VertexData();
  data.positions = [-4,-4,0, 4,-4,0, -4,4,0, 4,-4,0, 4,4,0, -4,4,0]; data.applyToMesh(mesh);
  placement.scaling.z = -1;
  mesh.isUnIndexed = true; mesh.parent = placement; mesh.position.set(0, -20, 2);
  assert.ok(camera.resolve(target, desired, desired, 1 / 60).z >= -1.780001);
  mesh.position.x = 100; mesh.computeWorldMatrix(true);
  const instance = mesh.createInstance('source-instance'); instance.parent = placement; instance.position.set(0, -20, 2);
  assert.ok(camera.resolve(target, desired, desired, 1 / 60).z >= -1.780001);
});

test('partition eviction and geometry changes preserve original render submeshes, materials and buffers', t => {
  const { scene, target, wall } = fixture(t), queries = new CameraMeshQueries(scene), ray = new Ray(target, new Vector3(0, 0, -1), 6);
  const original = wall('mutable', -2), renderParts = original.subMeshes.slice(), material = original.material, indices = original.getIndices();
  assert.ok((queries.closest(ray, original) ?? Infinity) < 2);
  for (let i = 0; i < 140; i++) queries.closest(ray, wall(`query-${i}`, -2, 100 + i));
  assert.deepEqual(original.subMeshes, renderParts); assert.equal(original.material, material); assert.equal(original.getIndices(), indices);
  const positions = original.getVerticesData('position')!.slice();
  for (let i = 2; i < positions.length; i += 3) positions[i] -= 2;
  original.setVerticesData('position', positions, true);
  assert.ok((queries.closest(ray, original) ?? Infinity) > 3.8, 'native point-cache invalidation rebuilds query bounds');
  original.setEnabled(false); queries.prune();
  assert.deepEqual(original.subMeshes, renderParts);
});

test('a tile-wide bounding box enclosing the camera is never treated as actual visual geometry', t => {
  const { scene, camera, target, desired } = fixture(t);
  const placement = new TransformNode('lh-tile-placement', scene), mesh = new Mesh('broad-bounds', scene), data = new VertexData();
  data.positions = [-50,-22,-50, 50,-22,-50, -50,-22,50, 40,20,40, 42,20,40, 40,22,42]; data.indices = [0,1,2,3,4,5];
  data.applyToMesh(mesh); mesh.parent = placement; mesh.computeWorldMatrix(true);
  assert.equal(mesh.getBoundingInfo().boundingBox.intersectsPoint(desired), true);
  assert.ok(camera.resolve(target, desired, desired, 1 / 60).equals(desired));
});

test('actual updateVerticesData deformation invalidates in-place native point-cache bounds', t => {
  const { scene, target, wall } = fixture(t), queries = new CameraMeshQueries(scene);
  const mutable = wall('damageable-prop', -2, 100); mutable.markVerticesDataAsUpdatable('position', true);
  const before = new Ray(new Vector3(100, -20, 0), new Vector3(0, 0, -1), 6);
  assert.ok((queries.closest(before, mutable) ?? Infinity) < 2);
  const points = mutable._positions, renderParts = mutable.subMeshes.slice(), positions = mutable.getVerticesData('position')!.slice();
  for (let i = 0; i < positions.length; i += 3) positions[i] -= 100;
  mutable.updateVerticesData('position', positions, true); mutable.computeWorldMatrix(true);
  const after = new Ray(target, new Vector3(0, 0, -1), 6), native = after.intersectsMesh(mutable, false);
  assert.equal(mutable._positions, points, 'Babylon intentionally reuses the same Vector3 cache array');
  assert.equal(native.hit, true); assert.equal(queries.closest(after, mutable), native.distance);
  assert.deepEqual(mutable.subMeshes, renderParts);
});

test('small deformed props between the boom rays still receive freshly rebuilt exact clearance', t => {
  const { scene, camera, target, desired, wall } = fixture(t);
  const prop = wall('small-damageable-prop', -4.88, 100, .02, .015); prop.scaling.y = .0025; prop.markVerticesDataAsUpdatable('position', true);
  camera.resolve(target.add(new Vector3(100, 0, 0)), desired.add(new Vector3(100, 0, 0)), desired.add(new Vector3(100, 0, 0)), 1 / 60);
  const positions = prop.getVerticesData('position')!.slice();
  for (let i = 0; i < positions.length; i += 3) positions[i] -= 99.93;
  prop.updateVerticesData('position', positions, true); prop.computeWorldMatrix(true);
  const position = camera.resolve(target, desired, desired, 1 / 60);
  assert.ok(position.z > -4.8, `${position.asArray()}`);
  assert.equal(scene.getPhysicsEngine(), null);
});

test('native updatable index buffers cannot retain query bounds for an old triangle selection', t => {
  const { scene, target } = fixture(t), queries = new CameraMeshQueries(scene), mesh = new Mesh('index-changing-prop', scene), data = new VertexData();
  data.positions = [96,-24,-2, 104,-24,-2, 100,-16,-2, -4,-24,-2, 4,-24,-2, 0,-16,-2]; data.indices = [0,1,2]; data.applyToMesh(mesh);
  mesh.setIndices([0,1,2], null, true); mesh.computeWorldMatrix(true);
  const ray = new Ray(target, new Vector3(0,0,-1), 6);
  assert.equal(queries.closest(ray, mesh), null);
  mesh.updateIndices([3,4,5], 0, false);
  assert.equal(ray.intersectsMesh(mesh, false).hit, true);
  assert.equal(queries.closest(ray, mesh), 2);
});

test('replacing an immutable vertex buffer invalidates query bounds even when native points are reused', t => {
  const { scene, target, wall } = fixture(t), queries = new CameraMeshQueries(scene), prop = wall('replaced-buffer', -2, 100);
  assert.ok((queries.closest(new Ray(new Vector3(100,-20,0),new Vector3(0,0,-1),6),prop) ?? Infinity) < 2);
  const points = prop._positions, positions = prop.getVerticesData('position')!.slice();
  for (let i=0;i<positions.length;i+=3) positions[i]-=100;
  prop.setVerticesData('position',positions,false); prop.computeWorldMatrix(true);
  const ray = new Ray(target,new Vector3(0,0,-1),6), native = ray.intersectsMesh(prop,false);
  assert.equal(prop._positions,points); assert.equal(native.hit,true); assert.equal(queries.closest(ray,prop),native.distance);
});
