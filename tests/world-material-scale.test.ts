import test from "node:test";
import assert from "node:assert/strict";
import { MeshBuilder, NullEngine, Scene, Vector3, VertexBuffer } from "@babylonjs/core";
import { applyMetreUVs } from "../src/world/authoring/metreUVs";

test("long roads and beach surfaces retain equal physical texture scale in both directions without changing shared boxes", () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const template = MeshBuilder.CreateBox("template", { size: 1 }, scene);
  const original = [...template.getVerticesData(VertexBuffer.UVKind)!];
  try {
    for (const [width, height, depth, tile, angle] of [[14, .1, 548, .75, 0], [55, 1, 1250, .5, 0], [18, 2, 67, .75, .61]]) {
      const mesh = template.clone("surface")!;
      mesh.scaling.set(width, height, depth); mesh.position.set(182.5, -.52, -100); mesh.rotation.y = angle;
      applyMetreUVs(mesh, tile);
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!, normals = mesh.getVerticesData(VertexBuffer.NormalKind)!, uvs = mesh.getVerticesData(VertexBuffer.UVKind)!;
      const transform = mesh.computeWorldMatrix(true);
      // Every pair on each planar face has the same metre-to-UV metric, including rotated sides.
      for (let a = 0; a < positions.length / 3; a++) for (let b = a + 1; b < positions.length / 3; b++) {
        if ([0, 1, 2].some(k => normals[a * 3 + k] !== normals[b * 3 + k])) continue;
        const start = Vector3.TransformCoordinates(Vector3.FromArray(positions, a * 3), transform), end = Vector3.TransformCoordinates(Vector3.FromArray(positions, b * 3), transform);
        const physical = Vector3.Distance(start, end), texture = Math.hypot(uvs[a * 2] - uvs[b * 2], uvs[a * 2 + 1] - uvs[b * 2 + 1]) * tile;
        assert.ok(Math.abs(physical - texture) < .0002, `physical ${physical}m versus texture ${texture}m`);
      }
      assert.deepEqual([...template.getVerticesData(VertexBuffer.UVKind)!], original, "source template UVs remain intact");
      mesh.dispose();
    }
  } finally { scene.dispose(); engine.dispose(); }
});
