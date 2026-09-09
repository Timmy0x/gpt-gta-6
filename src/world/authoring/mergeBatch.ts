import { Mesh } from '@babylonjs/core';

/** Keep shared primitive buffers immutable while Babylon combines authored batches. */
export function mergeAuthoredBatch(meshes: Mesh[]): Mesh | null {
  // Babylon 9.25 clones index arrays when disposeSource=false. With true, a box
  // plus a unique gable can append gable indices to the shared box template.
  const merged = Mesh.MergeMeshes(meshes, false, true, undefined, false, false);
  if (merged) for (const mesh of meshes) mesh.dispose();
  return merged;
}
