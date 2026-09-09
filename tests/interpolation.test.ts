import test from "node:test";
import assert from "node:assert/strict";
import { Mesh, NullEngine, Quaternion, Scene } from "@babylonjs/core";
import { PhysicsInterpolation } from "../src/core/PhysicsInterpolation";
test("render interpolation restores authoritative position/rotation and resets teleports", () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    mesh = new Mesh("body", scene);
  mesh.rotationQuaternion = Quaternion.Identity();
  const interpolation = new PhysicsInterpolation();
  interpolation.beforeStep([mesh]);
  mesh.position.x = 10;
  mesh.rotationQuaternion.copyFrom(Quaternion.RotationYawPitchRoll(1, 0, 0));
  interpolation.afterStep();
  interpolation.render(0.25);
  assert.equal(mesh.position.x, 2.5);
  assert.ok(Math.abs(mesh.rotationQuaternion.toEulerAngles().y - 0.25) < 1e-6);
  interpolation.restore();
  assert.equal(mesh.position.x, 10);
  assert.ok(Math.abs(mesh.rotationQuaternion.toEulerAngles().y - 1) < 1e-6);
  mesh.position.x = 100;
  interpolation.beforeStep([mesh]);
  interpolation.afterStep();
  interpolation.render(0);
  assert.equal(mesh.position.x, 100);
  mesh.dispose();
  interpolation.beforeStep([]);
  interpolation.render(0.5);
  scene.dispose();
  engine.dispose();
});

test('recovery between physics steps survives immediate render and authoritative restore', () => {
  const engine = new NullEngine(), scene = new Scene(engine), mesh = new Mesh('recoverable', scene);
  mesh.rotationQuaternion = Quaternion.Identity();
  const interpolation = new PhysicsInterpolation();
  try {
    interpolation.beforeStep([mesh]);mesh.position.x = 10;interpolation.afterStep();interpolation.render(.5);interpolation.restore();
    mesh.position.x = 100;mesh.rotationQuaternion = Quaternion.RotationYawPitchRoll(2, 0, 0);
    interpolation.render(.25);assert.equal(mesh.position.x, 100);assert.ok(Math.abs(mesh.rotationQuaternion.toEulerAngles().y - 2) < 1e-6);
    interpolation.restore();assert.equal(mesh.position.x, 100);
    mesh.rotationQuaternion.copyFrom(Quaternion.RotationYawPitchRoll(.3, 0, 0));
    interpolation.render(0);interpolation.restore();assert.ok(Math.abs(mesh.rotationQuaternion.toEulerAngles().y - .3) < 1e-6, 'rotation-only recovery invalidates history');
    interpolation.beforeStep([mesh]);mesh.position.x = 102;interpolation.afterStep();interpolation.render(.5);assert.equal(mesh.position.x, 101, 'ordinary subsequent physics still interpolates');interpolation.restore();assert.equal(mesh.position.x, 102);
  } finally { scene.dispose();engine.dispose(); }
});
