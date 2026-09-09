import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DirectionalLight, LoadAssetContainerAsync, Material, Matrix, NullEngine, Ray, Scene, ShadowGenerator, Vector3, VertexBuffer, type Mesh } from '@babylonjs/core';
import { Character } from '../src/gameplay/Character';
import { prepareCharacterAssets } from '../src/gameplay/characters/RocketboxSkin';
import { createVehicleModel } from '../src/vehicles/models';

function vertices(mesh: Mesh) {
  mesh.skeleton!.prepare(true);
  const matrices = mesh.skeleton!.getTransformMatrices(mesh), world = mesh.computeWorldMatrix(true);
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!, weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind)!, joints = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind)!;
  const transform = Matrix.Identity(), output: Vector3[] = [];
  for (let index = 0; index < mesh.getTotalVertices(); index++) {
    const point = Vector3.FromArray(positions, index * 3), result = Vector3.Zero();
    for (let influence = 0; influence < 4; influence++) {
      const weight = weights[index * 4 + influence]; if (!weight) continue;
      Matrix.FromArrayToRef(matrices, joints[index * 4 + influence] * 16, transform);
      result.addInPlace(Vector3.TransformCoordinates(point, transform).scale(weight));
    }
    output.push(Vector3.TransformCoordinates(result, world));
  }
  return output;
}

test('both full player skins and procedural fallbacks fit inside the actual aircraft cockpit surfaces', async context => {
  const engine = new NullEngine(), scene = new Scene(engine); scene.defaultMaterial = new Material('test/no-shader', scene);
  const shadows = new ShadowGenerator(16, new DirectionalLight('sun', Vector3.Down(), scene));
  try {
    await prepareCharacterAssets(scene, 'http://characters.test/', async url => {
      const bytes = await readFile(new URL(`../public/characters/rocketbox/${new URL(url).pathname.split('/').at(-1)}`, import.meta.url));
      return LoadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: '.glb', pluginOptions: { gltf: { skipMaterials: true } } });
    });
    for (const kind of ['plane', 'helicopter'] as const) for (const female of [false, true]) for (const licensedPlayerSkin of [true, false]) {
      const aircraft = createVehicleModel({ scene, shadows }, kind, 1);
      const character = new Character(scene, shadows, female ? 'Lucia' : 'Jason', '#ffffff', female, undefined, { licensedPlayerSkin });
      try {
        character.animate(1 / 60, 0); character.pose('seated', 1, 'upright');
        character.root.parent = aircraft.root;
        assert.ok(aircraft.seat, 'each aircraft supplies its own cockpit seat');
        character.root.position.copyFrom(aircraft.seat);
        scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(scene);
        const points = character.parts.filter(mesh => mesh.isVisible).flatMap(vertices);
        assert.ok(points.length > 1000);
        const floor = aircraft.panels.find(mesh => mesh.name === 'fuselage-1')!;
        const roofs = kind === 'plane' ? aircraft.windows : [floor, ...aircraft.windows];
        floor.computeWorldMatrix(true); roofs.forEach(mesh => mesh.computeWorldMatrix(true));
        let roofClearance = Infinity, floorClearance = Infinity;
        for (const point of points) {
          assert.ok([point.x, point.y, point.z].every(Number.isFinite));
          const top = roofs.map(roof => new Ray(new Vector3(point.x, 3, point.z), Vector3.Down(), 6).intersectsMesh(roof)).filter(hit => hit.hit && hit.pickedPoint).sort((a, b) => b.pickedPoint!.y - a.pickedPoint!.y)[0];
          const bottom = new Ray(new Vector3(point.x, -3, point.z), Vector3.Up(), 6).intersectsMesh(floor);
          assert.ok(top?.hit && top.pickedPoint, `${kind} ${character.root.name}: vertex outside cockpit outline at ${point.asArray()}`);
          assert.ok(bottom.hit && bottom.pickedPoint, `${kind} ${character.root.name}: vertex outside fuselage floor at ${point.asArray()}`);
          roofClearance = Math.min(roofClearance, top.pickedPoint.y - point.y);
          floorClearance = Math.min(floorClearance, point.y - bottom.pickedPoint.y);
        }
        assert.ok(roofClearance >= .008, `${kind} ${character.root.name}: body intersects roof/glazing by ${-roofClearance}m`);
        assert.ok(floorClearance >= .008, `${kind} ${character.root.name}: body intersects fuselage floor by ${-floorClearance}m`);
        assert.deepEqual(aircraft.panels.map(mesh => mesh.getTotalVertices()), kind === 'plane' ? [20, 12, 16] : [20, 12, 8], 'existing serialized damage geometry layout remains compatible');
        const bounds = { min: [Math.min(...points.map(p => p.x)), Math.min(...points.map(p => p.y)), Math.min(...points.map(p => p.z))], max: [Math.max(...points.map(p => p.x)), Math.max(...points.map(p => p.y)), Math.max(...points.map(p => p.z))] };
        context.diagnostic(`${kind} ${character.root.name} ${licensedPlayerSkin ? 'licensed' : 'fallback'}: ${points.length} vertices, roof clearance ${roofClearance.toFixed(4)}m, floor clearance ${floorClearance.toFixed(4)}m; ${JSON.stringify(bounds)}`);
      } finally { character.dispose(); shadows.removeShadowCaster(aircraft.root, true); aircraft.root.dispose(); for (const material of aircraft.materials) material.dispose(); }
    }
  } finally { shadows.dispose(); scene.dispose(); engine.dispose(); }
});
