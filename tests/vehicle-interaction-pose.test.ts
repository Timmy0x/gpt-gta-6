import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DirectionalLight, LoadAssetContainerAsync, Material, Matrix, NullEngine, Quaternion, Scene, ShadowGenerator, Vector3, VertexBuffer, type Mesh } from '@babylonjs/core';
import { Character } from '../src/gameplay/Character';
import { prepareCharacterAssets, prepareCivilianAssets } from '../src/gameplay/characters/RocketboxSkin';
import { poseVehicleEntrant, poseVehicleWithdrawal, vehicleDoorContact, vehicleMountPosition, VEHICLE_INTERACTION_TIMING } from '../src/gameplay/VehicleInteractionPose';
import { vehicleSeatOffset, vehicleSeatPose, type TrafficOccupant } from '../src/gameplay/VehicleOccupancy';
import { ConceptCarAssets } from '../src/vehicles/ConceptCar';
import { createVehicleModel } from '../src/vehicles/models';
import { VEHICLE_TUNING } from '../src/vehicles/handling';
import type { Vehicle } from '../src/vehicles/VehicleSystem';

function fixture() {
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.defaultMaterial = new Material('test/no-shader', scene);
  const shadows = new ShadowGenerator(16, new DirectionalLight('sun', Vector3.Down(), scene));
  return { scene, shadows, dispose() { shadows.dispose(); scene.dispose(); engine.dispose(); } };
}
function visibleVertices(mesh: Mesh) {
  mesh.skeleton!.prepare(true);
  const matrices = mesh.skeleton!.getTransformMatrices(mesh), world = mesh.computeWorldMatrix(true);
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!, weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind)!, joints = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind)!;
  const matrix = Matrix.Identity(), output: Vector3[] = [];
  for (let index = 0; index < mesh.getTotalVertices(); index += 7) {
    const point = Vector3.FromArray(positions, index * 3), result = Vector3.Zero();
    for (let influence = 0; influence < 4; influence++) {
      const weight = weights[index * 4 + influence]; if (!weight) continue;
      Matrix.FromArrayToRef(matrices, joints[index * 4 + influence] * 16, matrix);
      result.addInPlace(Vector3.TransformCoordinates(point, matrix).scale(weight));
    }
    output.push(Vector3.TransformCoordinates(result, world));
  }
  return output;
}

test('native IK reaches all four actual gameplay limbs under translated and rotated character roots, then disposes its resources', () => {
  const f = fixture();
  try {
    for (const female of [false, true]) {
      const before = [f.scene.meshes.length, f.scene.skeletons.length, f.scene.transformNodes.length];
      const character = new Character(f.scene, f.shadows, 'contact', '#ffffff', female);
      const limbs = [['leftHand', [-.35, 1.20, .30]], ['rightHand', [.38, 1.14, .26]], ['leftFoot', [-.16, .15, .10]], ['rightFoot', [.18, .14, -.07]]] as const;
      for (const yaw of [0, .8, Math.PI, -2.2]) for (const [limb, target] of limbs) {
        character.animate(0, 0);
        character.root.position.set(14, .03, -24);
        character.root.rotationQuaternion = Quaternion.RotationYawPitchRoll(yaw, .08, -.04);
        const goal = Vector3.TransformCoordinates(Vector3.FromArray(target), character.root.computeWorldMatrix(true));
        if (limb.endsWith('Hand')) character.reachHand(limb.startsWith('left') ? -1 : 1, goal);
        else character.plantFoot(limb.startsWith('left') ? -1 : 1, goal);
        assert.ok(Vector3.Distance(character.jointPosition(limb), goal) < .00001, `${limb} target under yaw ${yaw}`);
      }
      assert.equal(character.skeleton.bones.length, 17, 'the physics/skin driver rig is unchanged');
      assert.equal(f.scene.skeletons.find(s => s.name.endsWith('/contact-ik'))!.bones.length, 13, 'one shared-root solver rig serves four limbs');
      character.dispose();
      assert.deepEqual([f.scene.meshes.length, f.scene.skeletons.length, f.scene.transformNodes.length], before);
    }
  } finally { f.dispose(); }
});

test('contact overlays preserve bone lengths, clamp unreachable targets and do not overwrite dead or ragdoll poses', () => {
  const f = fixture(), character = new Character(f.scene, f.shadows, 'guarded-contact');
  try {
    character.animate(0, 0);
    const lengths = character.skeleton.bones.map(b => b.getPosition().length());
    character.reachHand(-1, new Vector3(100, 100, 100));
    assert.ok(character.jointPosition('leftHand').length() < 3);
    character.reachHand(1, character.jointPosition('rightArm'));
    assert.ok(character.skeleton.bones.every(b => [...b.getAbsoluteMatrix().m].every(Number.isFinite)));
    character.skeleton.bones.forEach((b, index) => assert.ok(Math.abs(b.getPosition().length() - lengths[index]) < .000001));
    for (const state of ['dead', 'ragdoll'] as const) {
      character.dead = state === 'dead'; character.root.metadata = { ragdollActive: state === 'ragdoll' };
      const before = character.skeleton.bones.map(b => [...b.getLocalMatrix().m]);
      character.interactionPosture(.3, .8, .2); character.reachHand(-1, Vector3.One()); character.plantFoot(1, Vector3.Zero());
      assert.deepEqual(character.skeleton.bones.map(b => [...b.getLocalMatrix().m]), before);
    }
  } finally { character.dispose(); f.dispose(); }
});

test('entry path stays continuous between the validated doorway and seat while delaying hip lowering', () => {
  const from = new Vector3(-1.6, 0, .12), to = new Vector3(-.5, -.69, .1);
  assert.ok(vehicleMountPosition(from, to, 0).equals(from));
  assert.ok(vehicleMountPosition(from, to, 1).equals(to));
  assert.equal(vehicleMountPosition(from, to, .2).y, from.y);
  let previous = from;
  for (let frame = 1; frame <= 40; frame++) {
    const point = vehicleMountPosition(from, to, frame / 40);
    assert.ok(Vector3.Distance(point, previous) < .08);
    assert.ok(point.x >= from.x && point.x <= to.x && point.y <= from.y && point.y >= to.y);
    previous = point;
  }
});

test('both licensed protagonists contact both licensed civilian drivers with grounded feet during sedan and concept-car withdrawal', async context => {
  const f = fixture();
  const asset = new ConceptCarAssets({ scene: f.scene, shadows: f.shadows }, new Uint8Array(await readFile(new URL('../public/vehicles/concept/car-lod1-batched.glb', import.meta.url))), true);
  let maxContact = 0, maxPlant = 0, sampledVertices = 0, minimumVisualHeight = Infinity;
  try {
    const load = async (url: string) => {
      const bytes = await readFile(new URL('../public' + new URL(url).pathname, import.meta.url));
      return LoadAssetContainerAsync(new Uint8Array(bytes), f.scene, { pluginExtension: '.glb', pluginOptions: { gltf: { skipMaterials: true } } });
    };
    await prepareCharacterAssets(f.scene, 'http://local/characters/rocketbox/', load);
    await prepareCivilianAssets(f.scene, 'http://local/characters/civilians/', load);
    await asset.prepare();
    for (const kind of ['sedan', 'concept'] as const) for (const female of [false, true]) for (const civilian of ['male-adult-03', 'female-adult-06'] as const) {
      const model = kind === 'concept' ? asset.create(44) : createVehicleModel({ scene: f.scene, shadows: f.shadows }, kind, 44);
      model.root.position.y = .641; model.root.computeWorldMatrix(true);
      const vehicle = { model, root: model.root, kind, tuning: VEHICLE_TUNING[kind], heading: 0 } as Vehicle;
      const actor = new Character(f.scene, f.shadows, female ? 'Lucia' : 'Jason', '#ffffff', female, undefined, { licensedPlayerSkin: true });
      const driver = new Character(f.scene, f.shadows, civilian, '#ffffff', civilian.startsWith('female'), undefined, { licensedCivilianSkin: civilian });
      try {
        const start = Vector3.TransformCoordinates(vehicleSeatOffset(vehicle), model.root.getWorldMatrix());
        const destination = new Vector3(-vehicle.tuning.width / 2 - .7, 0, -.65), doorway = new Vector3(-vehicle.tuning.width / 2 - .48, 0, -.20);
        const occupant = { vehicle, model: driver, start, destination } as TrafficOccupant;
        const door = model.doors.find(d => d.side === -1 && d.front)!;
        const closedHandle = vehicleDoorContact(vehicle, -1)!;
        door.mesh.rotation.y = 1.12;
        assert.ok(Vector3.Distance(vehicleDoorContact(vehicle, -1)!, closedHandle) > .08, 'reach target follows the actual opening door');
        let previous = start;
        for (let frame = 0; frame <= 50; frame++) {
          const p = frame / 50;
          driver.animate(1 / 60, 0); poseVehicleWithdrawal(occupant, p, vehicleSeatPose(vehicle));
          actor.animate(1 / 60, 0); poseVehicleEntrant(actor, vehicle, 'ejecting-driver', p * VEHICLE_INTERACTION_TIMING.ejection / (VEHICLE_INTERACTION_TIMING.ejection + VEHICLE_INTERACTION_TIMING.handoff), doorway, doorway, start, -1, vehicleSeatPose(vehicle), driver);
          assert.ok(Vector3.Distance(driver.root.position, previous) < .12, 'driver root follows a continuous withdrawal'); previous = driver.root.position.clone();
          if (p >= .30 && p <= .55) {
            const shoulder = driver.jointPosition('leftArm', new Vector3(-.035, -.015, .03)), forearm = driver.jointPosition('leftForearm', new Vector3(-.02, -.10, .015));
            maxContact = Math.max(maxContact, Vector3.Distance(actor.jointPosition('rightHand'), shoulder), Vector3.Distance(actor.jointPosition('leftHand'), forearm));
            if (p < .40) maxPlant = Math.max(maxPlant, Math.abs(actor.jointPosition('rightFoot').y - .13));
          }
          if ([10, 25, 35, 45].includes(frame)) {
            f.scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(f.scene);
            assert.ok(actor.parts.slice(1).every(m => m.skeleton?.bones.length === 80));
            for (const mesh of actor.parts.slice(1)) for (const point of visibleVertices(mesh)) {
              sampledVertices++;
              minimumVisualHeight = Math.min(minimumVisualHeight, point.y);
              assert.ok([point.x, point.y, point.z].every(Number.isFinite));
              assert.ok(Vector3.Distance(point, actor.root.position) < 3);
              assert.ok(point.y >= 0, `${kind}/${actor.root.name}/${civilian} frame ${frame}: planted visual skin penetrates ground at ${point.y}; ankles ${actor.jointPosition('leftFoot').y}, ${actor.jointPosition('rightFoot').y}`);
            }
          }
        }
        assert.ok(driver.root.position.equalsWithEpsilon(destination, .00001), 'actor identity handoff uses the validated destination');
      } finally {
        actor.dispose(); driver.dispose(); f.shadows.removeShadowCaster(model.root, true); model.root.dispose(); for (const material of model.materials) material.dispose();
      }
    }
    assert.ok(maxContact < .065, `contact wrist must remain within hand-length of shoulder/forearm: ${maxContact}`);
    assert.ok(maxPlant < .001, `support foot remains planted during the pull: ${maxPlant}`);
    assert.ok(sampledVertices > 10000);
    context.diagnostic(`8 detailed actor/driver/vehicle combinations; max contact wrist gap ${maxContact.toFixed(5)} m; max support ankle drift ${maxPlant.toFixed(7)} m; minimum sampled visual height ${minimumVisualHeight.toFixed(5)} m; ${sampledVertices} sampled skinned vertices checked.`);
  } finally { asset.dispose(); f.dispose(); }
});
