import {
  Color3, MeshBuilder, PhysicsAggregate, PhysicsShapeType, Quaternion, StandardMaterial, Vector3,
  type Scene,
} from '@babylonjs/core';

export const PROOF = {
  floorTop: 8.25,
  floorCenter: new Vector3(42, 8.05, 6),
  walkerStart: new Vector3(38.5, 9.17, 2),
  obstacleCenter: new Vector3(38.5, 8.85, 5),
  ballStart: new Vector3(45.5, 12, 4),
};

/** Independent authored metre-scale physics; no collider is derived from tile geometry. */
export function createProofPhysics(scene: Scene) {
  function material(name: string, color: string) {
    const value = new StandardMaterial(name, scene);
    value.diffuseColor = Color3.FromHexString(color);
    value.specularColor = new Color3(.07, .07, .07);
    return value;
  }
  const floor = MeshBuilder.CreateBox('original-floor', { width: 24, depth: 24, height: .4 }, scene);
  floor.position.copyFrom(PROOF.floorCenter);
  floor.material = material('floor-material', '#527b80');
  const floorPhysics = new PhysicsAggregate(floor, PhysicsShapeType.BOX, { mass: 0, friction: .7, restitution: 0 }, scene);
  const obstacle = MeshBuilder.CreateBox('original-static-obstacle', { width: 1.5, depth: 1, height: 1.2 }, scene);
  obstacle.position.copyFrom(PROOF.obstacleCenter);
  obstacle.material = material('obstacle-material', '#dfaa42');
  const obstaclePhysics = new PhysicsAggregate(obstacle, PhysicsShapeType.BOX, { mass: 0, friction: .4, restitution: 0 }, scene);
  const walker = MeshBuilder.CreateCapsule('original-walker', { radius: .32, height: 1.8, tessellation: 16 }, scene);
  walker.position.copyFrom(PROOF.walkerStart);
  walker.material = material('walker-material', '#ecdfbd');
  const walkerPhysics = new PhysicsAggregate(walker, PhysicsShapeType.CAPSULE, { mass: 75, friction: 0, restitution: 0 }, scene);
  walkerPhysics.body.setMassProperties({ inertia: Vector3.Zero() });
  const ball = MeshBuilder.CreateSphere('original-dynamic-ball', { diameter: .65, segments: 20 }, scene);
  ball.position.copyFrom(PROOF.ballStart);
  ball.material = material('ball-material', '#f87863');
  const ballPhysics = new PhysicsAggregate(ball, PhysicsShapeType.SPHERE, { mass: 3, friction: .6, restitution: .3 }, scene);
  let input = Vector3.Zero();
  let enabled = false;
  const update = scene.onBeforePhysicsObservable.add(() => {
    const velocity = walkerPhysics.body.getLinearVelocity();
    const direction = enabled ? input : Vector3.ZeroReadOnly;
    walkerPhysics.body.setLinearVelocity(new Vector3(direction.x * 2.7, velocity.y, direction.z * 2.7));
  });
  function resetBody(body: PhysicsAggregate, position: Vector3) {
    body.body.disablePreStep = false;
    body.transformNode.position.copyFrom(position);
    body.transformNode.rotationQuaternion = Quaternion.Identity();
    body.body.setLinearVelocity(Vector3.Zero());
    body.body.setAngularVelocity(Vector3.Zero());
    const observer = scene.onAfterPhysicsObservable.addOnce(() => { body.body.disablePreStep = true; });
    return observer;
  }
  return {
    floor, obstacle, walker, ball, walkerPhysics, ballPhysics,
    setWalking(value: boolean) { enabled = value; input.setAll(0); },
    setInput(x: number, z: number) { input.set(x, 0, z); if (input.lengthSquared() > 1) input.normalize(); },
    dropBall() { resetBody(ballPhysics, PROOF.ballStart); },
    resetWalker() { resetBody(walkerPhysics, PROOF.walkerStart); },
    dispose() {
      scene.onBeforePhysicsObservable.remove(update);
      for (const aggregate of [floorPhysics, obstaclePhysics, walkerPhysics, ballPhysics]) aggregate.dispose();
      for (const mesh of [floor, obstacle, walker, ball]) mesh.dispose(false, true);
    },
  };
}
