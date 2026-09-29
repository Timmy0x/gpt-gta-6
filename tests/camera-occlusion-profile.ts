import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { Logger, Mesh, NullEngine, Scene, TransformNode, Vector3, VertexData } from '@babylonjs/core';
import { CameraOcclusion } from '../src/core/CameraOcclusion';

// Reproduce a dense, broad-bounds visual workload with synthetic data only:
// node --import tsx tests/camera-occlusion-profile.ts
Logger.LogLevels = Logger.NoneLogLevel;
const results = [];
for (const size of [250, 500]) {
  const engine = new NullEngine(), scene = new Scene(engine), placement = new TransformNode('lh-tile-placement', scene);
  const positions: number[] = [], indices: number[] = [];
  for (let row = 0; row <= size; row++) for (let col = 0; col <= size; col++) positions.push(col * 100 / size - 50, -22, row * 100 / size - 50);
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const a = row * (size + 1) + col, b = a + 1, c = a + size + 1, d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
  const top = positions.length / 3; positions.push(40,20,40, 42,20,40, 40,22,42); indices.push(top, top + 1, top + 2);
  const mesh = new Mesh('synthetic-visual', scene), data = new VertexData(); data.positions = positions; data.indices = indices; data.applyToMesh(mesh);
  mesh.parent = placement; mesh.computeWorldMatrix(true);
  const originalParts = mesh.subMeshes.slice(), originalIndices = mesh.getIndices(), camera = new CameraOcclusion(scene);
  const target = new Vector3(0, -20, 0), desired = new Vector3(0, -20, -5), samples: number[] = []; let coldMs = 0;
  for (let i = 0; i < 32; i++) {
    const start = performance.now(), position = camera.resolve(target, desired, desired, 1 / 60), ms = performance.now() - start;
    assert.ok(position.equals(desired)); if (i === 0) coldMs = ms; if (i >= 4) samples.push(ms);
  }
  samples.sort((a,b) => a - b);
  assert.deepEqual(mesh.subMeshes, originalParts); assert.equal(mesh.getIndices(), originalIndices);
  results.push({ triangles: indices.length / 3, frames: samples.length, coldMs, medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * .95)], maxMs: samples.at(-1), renderSubmeshes: mesh.subMeshes.length });
  scene.dispose(); engine.dispose();
}
console.log(JSON.stringify({ scope: 'Synthetic CPU camera query workload; not live browser FPS or Google tile data', engine: 'Babylon 9.25.0 NullEngine', node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? 'unavailable', measuredAt: new Date().toISOString(), results }, null, 2));
