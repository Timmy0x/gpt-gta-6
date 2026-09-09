import { Quaternion, Vector3, type Mesh } from "@babylonjs/core";
type State = {
  mesh: Mesh;
  previous: Vector3;
  current: Vector3;
  previousRotation: Quaternion;
  rotation: Quaternion;
};

/** Render-only interpolation. Authoritative body transforms are restored after rendering. */
export class PhysicsInterpolation {
  private states = new Map<Mesh, State>();
  beforeStep(meshes: Mesh[]) {
    const live = new Set(meshes);
    for (const [mesh] of this.states)
      if (!live.has(mesh) || mesh.isDisposed()) this.states.delete(mesh);
    for (const mesh of meshes) {
      if (!mesh.rotationQuaternion) continue;
      let state = this.states.get(mesh);
      if (!state) {
        state = {
          mesh,
          previous: mesh.position.clone(),
          current: mesh.position.clone(),
          previousRotation: mesh.rotationQuaternion.clone(),
          rotation: mesh.rotationQuaternion.clone(),
        };
        this.states.set(mesh, state);
      }
      this.invalidateExternalTransform(state);
      state.previous.copyFrom(state.current);
      state.previousRotation.copyFrom(state.rotation);
    }
  }
  afterStep() {
    for (const state of this.states.values())
      if (!state.mesh.isDisposed()) {
        state.current.copyFrom(state.mesh.position);
        state.rotation.copyFrom(state.mesh.rotationQuaternion!);
      }
  }
  render(alpha: number) {
    for (const s of this.states.values())
      if (!s.mesh.isDisposed()) {
        // UI recovery can occur between physics steps. Detect it before rendering
        // overwrites the authoritative transform, including rotation-only recovery.
        this.invalidateExternalTransform(s);
        Vector3.LerpToRef(s.previous, s.current, alpha, s.mesh.position);
        Quaternion.SlerpToRef(
          s.previousRotation,
          s.rotation,
          alpha,
          s.mesh.rotationQuaternion!,
        );
        s.mesh.computeWorldMatrix(true);
      }
  }
  private invalidateExternalTransform(state: State) {
    const rotation = state.mesh.rotationQuaternion;
    if (
      rotation &&
      (Vector3.DistanceSquared(state.current, state.mesh.position) > 1e-8 ||
        1 - Math.abs(Quaternion.Dot(state.rotation, rotation)) > 1e-7)
    ) {
      state.previous.copyFrom(state.mesh.position);
      state.current.copyFrom(state.mesh.position);
      state.previousRotation.copyFrom(rotation);
      state.rotation.copyFrom(rotation);
    }
  }
  restore() {
    for (const s of this.states.values())
      if (!s.mesh.isDisposed()) {
        s.mesh.position.copyFrom(s.current);
        s.mesh.rotationQuaternion!.copyFrom(s.rotation);
        s.mesh.computeWorldMatrix(true);
      }
  }
}
