import { MeshBuilder, StandardMaterial, type Camera, type Mesh, type Scene } from '@babylonjs/core';

/** Distant water extinction, drawn with ordinary depth testing behind nearby geometry.
 * It fills rays that run beyond finite ocean geometry with the SAME exponential fog
 * as the submerged world, instead of allowing the unfogged atmospheric sky through.
 * The actual surface, reflection and refraction remain visible in front of it.
 */
export class Underwater {
  readonly mesh: Mesh;
  private material: StandardMaterial;

  constructor(scene: Scene) {
    this.material = new StandardMaterial('ocean/underwater-extinction', scene);
    this.material.disableLighting = true;
    this.material.diffuseColor.setAll(0); this.material.emissiveColor.setAll(0); this.material.specularColor.setAll(0);
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.fogEnabled = true;
    this.mesh = MeshBuilder.CreateBox('ocean/underwater-extinction', { size: 2 }, scene);
    this.mesh.material = this.material;
    this.mesh.infiniteDistance = true;
    this.mesh.applyFog = true;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.metadata = { ocean: true, underwaterExtinction: true };
    this.mesh.setEnabled(false);
  }

  update(camera: Camera, submerged: boolean): void {
    this.mesh.setEnabled(submerged);
    // At 100m the current submerged EXP2 fog is effectively fully attenuated.
    // Staying well inside maxZ prevents the background itself creating a far-plane slit.
    this.mesh.scaling.setAll(Math.max(camera.minZ * 4, Math.min(100, camera.maxZ * .3)));
  }
  dispose(): void { this.mesh.dispose(); this.material.dispose(); }
}
