import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  DirectionalLight,
  Material,
  Matrix,
  NullEngine,
  Scene,
  ShadowGenerator,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { Character } from "../src/gameplay/Character";

function fixture(context: TestContext) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  // These tests inspect real geometry and bone transforms, without compiling shaders.
  scene.defaultMaterial = new Material("test/default-no-shaders", scene);
  const light = new DirectionalLight("test/sun", new Vector3(0, -1, 0), scene);
  const shadows = new ShadowGenerator(128, light);
  context.after(() => {
    shadows.dispose();
    scene.dispose();
    engine.dispose();
  });
  return { scene, shadows };
}

function transforms(character: Character): number[] {
  // No render loop advances the scene frame ID in NullEngine tests.
  character.skeleton.prepare(true);
  return Array.from(
    character.skeleton.getTransformMatrices(character.parts[0]),
  );
}

function advance(
  character: Character,
  frames: number,
  speed: number,
  aim = false,
  crouch = false,
) {
  for (let frame = 0; frame < frames; frame++)
    character.animate(1 / 60, speed, aim, crouch);
  return transforms(character);
}

function skinVertex(
  character: Character,
  vertex: number,
  matrices: number[],
): Vector3 {
  const mesh = character.parts[0];
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind)!;
  const indices = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind)!;
  const position = Vector3.FromArray(positions, vertex * 3);
  const output = Vector3.Zero();
  for (let influence = 0; influence < 4; influence++) {
    const weight = weights[vertex * 4 + influence];
    if (weight === 0) continue;
    const matrix = Matrix.FromArray(
      matrices,
      indices[vertex * 4 + influence] * 16,
    );
    output.addInPlace(
      Vector3.TransformCoordinates(position, matrix).scale(weight),
    );
  }
  return output;
}

test("low driving pose keeps both character variants' skinned feet above the cabin floor and head below the roof", context => {
  const { scene, shadows } = fixture(context);
  for (const female of [false, true]) {
    const character = new Character(scene, shadows, female ? "Lucia" : "Jason", "#ffffff", female);
    character.animate(1 / 60, 0);
    character.pose("seated", 1, "low");
    const matrices = transforms(character);
    const vertices = Array.from({ length: character.parts[0].getTotalVertices() }, (_, i) => skinVertex(character, i, matrices));
    const foot = Math.min(...vertices.map(v => v.y)) - 0.92;
    const head = Math.max(...vertices.map(v => v.y)) - 0.92;
    assert.ok(foot >= -0.25, `feet protrude below cabin floor: ${foot}`);
    assert.ok(head <= 0.94, `head protrudes through roof: ${head}`);
    assert.ok(Math.max(...vertices.map(v => v.z)) < 1.1, "feet stay inside the pedal/hood space");
    character.dispose();
  }
});

test("reclined driving pose clears the detailed concept car's floor and roof", context => {
  const { scene, shadows } = fixture(context);
  for (const female of [false, true]) {
    const character = new Character(scene, shadows, female ? "Lucia" : "Jason", "#ffffff", female);
    character.animate(1 / 60, 0); character.pose("seated", 1, "reclined");
    const matrices = transforms(character);
    const vertices = Array.from({ length: character.parts[0].getTotalVertices() }, (_, i) => skinVertex(character, i, matrices));
    assert.ok(Math.min(...vertices.map(v => v.y)) - 1.30 >= -0.49, "body and shoes clear the imported cabin floor");
    assert.ok(Math.max(...vertices.map(v => v.y)) - 1.30 <= 0.51, "head clears the imported roof underside");
    const head = vertices.filter(v => v.y > 1.6);
    assert.ok(head.every(v => v.z + 0.1 >= -0.44 && v.z + 0.1 <= 0.20), "reclined head remains under the roof span");
    character.dispose();
  }
});

test("both character variants have valid skinned geometry and one render submesh", (context) => {
  const { scene, shadows } = fixture(context);
  for (const female of [false, true]) {
    const character = new Character(
      scene,
      shadows,
      female ? "Lucia" : "Jason",
      "#b47566",
      female,
    );
    const mesh = character.parts[0];
    assert.equal(
      character.parts.length,
      1,
      "crowd characters must not return to per-limb draw calls",
    );
    assert.equal(
      mesh.subMeshes.length,
      1,
      "one submesh is submitted per character per render pass",
    );
    assert.equal(mesh.skeleton, character.skeleton);
    assert.ok(
      character.skeleton.bones.length >= 15,
      "a full body rig includes knees and elbows",
    );
    assert.equal(
      character.skeleton.bones.filter((bone) => !bone.getParent()).length,
      1,
    );
    assert.ok(mesh.getTotalVertices() > 1000 && mesh.getTotalVertices() < 6500);

    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
    const colors = mesh.getVerticesData(VertexBuffer.ColorKind)!;
    const weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind)!;
    const boneIndices = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind)!;
    assert.equal(positions.length, mesh.getTotalVertices() * 3);
    assert.equal(normals.length, positions.length);
    assert.equal(colors.length, mesh.getTotalVertices() * 4);
    assert.equal(weights.length, colors.length);
    assert.equal(boneIndices.length, colors.length);
    for (const values of [positions, normals, colors, weights, boneIndices])
      assert.ok(values.every(Number.isFinite));
    for (const index of mesh.getIndices()!)
      assert.ok(index >= 0 && index < mesh.getTotalVertices());
    for (let vertex = 0; vertex < mesh.getTotalVertices(); vertex++) {
      let sum = 0;
      for (let influence = 0; influence < 4; influence++) {
        const offset = vertex * 4 + influence;
        const weight = weights[offset];
        assert.ok(weight >= 0 && weight <= 1);
        assert.ok(
          Number.isInteger(boneIndices[offset]) &&
            boneIndices[offset] < character.skeleton.bones.length,
        );
        sum += weight;
      }
      assert.ok(
        Math.abs(sum - 1) < 1e-6,
        "every skin vertex has normalized bone weights",
      );
    }
    // The first ring's +X side must face outward, catching reversed triangle winding.
    assert.ok(normals[0] > 0);
    const pose = transforms(character);
    for (let vertex = 0; vertex < mesh.getTotalVertices(); vertex += 23) {
      const original = Vector3.FromArray(positions, vertex * 3);
      assert.ok(
        Vector3.Distance(original, skinVertex(character, vertex, pose)) < 1e-5,
        "bind pose preserves authored geometry",
      );
    }
    context.diagnostic(
      `${character.root.name}: ${mesh.getTotalVertices()} vertices, ${mesh.getTotalIndices() / 3} triangles, ${character.skeleton.bones.length} bones.`,
    );
    character.dispose();
  }
});

test("walk and run skin the feet while aiming raises the hand and crouching recovers", (context) => {
  const { scene, shadows } = fixture(context);
  const character = new Character(scene, shadows, "movement-check");
  const mesh = character.parts[0];
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  let footVertex = 0;
  while (positions[footVertex * 3 + 1] > 0.08) footVertex++;
  const rest = skinVertex(character, footVertex, transforms(character));
  let footTravel = 0;
  for (let frame = 0; frame < 180; frame++) {
    character.animate(1 / 60, frame < 90 ? 3.7 : 7.1);
    const matrices = transforms(character);
    assert.ok(matrices.every(Number.isFinite));
    const foot = skinVertex(character, footVertex, matrices);
    footTravel = Math.max(footTravel, Vector3.Distance(rest, foot));
    assert.ok(
      foot.y > -0.4 && foot.y < 0.9 && Math.abs(foot.z) < 1,
      "locomotion stays inside human-scale bounds",
    );
  }
  assert.ok(
    footTravel > 0.15,
    "the skinned feet move rather than only the scene root",
  );
  advance(character, 90, 0);
  const hand = character.skeleton.bones.find((bone) =>
    bone.name.endsWith("/rightHand"),
  )!;
  const handAtRest = hand.getAbsolutePosition().clone();
  advance(character, 90, 0, true);
  assert.ok(
    hand.getAbsolutePosition().z > handAtRest.z + 0.25,
    "aiming reaches forward",
  );
  advance(character, 90, 0, false, true);
  assert.ok(character.root.scaling.y < 0.83);
  advance(character, 120, 0);
  assert.ok(
    Math.abs(character.root.scaling.y - 1) < 1e-5,
    "standing recovers after crouch",
  );
  character.dispose();
});

test("characters share their material safely across repeated character switching", (context) => {
  const { scene, shadows } = fixture(context);
  const keeper = new Character(scene, shadows, "remaining-civilian");
  const shared = keeper.parts[0].material!;
  const baseline = {
    meshes: scene.meshes.length,
    skeletons: scene.skeletons.length,
    materials: scene.materials.length,
  };
  for (let switchIndex = 0; switchIndex < 30; switchIndex++) {
    const character = new Character(
      scene,
      shadows,
      `switch-${switchIndex}`,
      "#915f54",
      switchIndex % 2 === 0,
    );
    assert.equal(character.parts[0].material, shared);
    character.parts[0].metadata = { characterId: switchIndex };
    advance(character, 3, 3.7);
    character.dispose();
    character.dispose(); // Repeated cleanup must not release another character's material.
    assert.equal(scene.meshes.length, baseline.meshes);
    assert.equal(scene.skeletons.length, baseline.skeletons);
    assert.equal(scene.materials.length, baseline.materials);
    assert.ok(scene.materials.includes(shared));
    assert.equal(keeper.parts[0].isDisposed(), false);
  }
  keeper.dispose();
  assert.equal(scene.meshes.length, 0);
  assert.equal(scene.skeletons.length, 0);
  assert.equal(
    scene.materials.includes(shared),
    false,
    "last character releases the shared material",
  );
  const replacement = new Character(scene, shadows, "new-session");
  assert.notEqual(replacement.parts[0].material, shared);
  replacement.dispose();
});

test("equal fixed-step inputs produce equal joint poses without moving the controller root", (context) => {
  const { scene, shadows } = fixture(context);
  const first = new Character(scene, shadows, "deterministic-a");
  const second = new Character(scene, shadows, "deterministic-b");
  const origin = new Vector3(17, 0.16, -21);
  first.position(origin);
  second.position(origin);
  for (let frame = 0; frame < 240; frame++) {
    const speed = frame < 90 ? 3.7 : frame < 180 ? 7.1 : 0;
    const aim = frame >= 180 && frame < 210;
    const crouch = frame >= 210;
    first.animate(1 / 60, speed, aim, crouch);
    second.animate(1 / 60, speed, aim, crouch);
  }
  const left = transforms(first),
    right = transforms(second);
  assert.equal(left.length, right.length);
  assert.ok(
    left.every((value, index) => Math.abs(value - right[index]) < 1e-7),
  );
  assert.deepEqual(first.root.position.asArray(), origin.asArray());
  assert.deepEqual(second.root.position.asArray(), origin.asArray());
  first.dispose();
  second.dispose();
});
