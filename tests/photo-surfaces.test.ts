import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

test("streamed photographic materials resolve to intact local maps with the source color/data channels", () => {
  const root = resolve("public"), manifest = JSON.parse(readFileSync(`${root}/surfaces/manifest.json`, "utf8"));
  const materials = readdirSync(`${root}/world/materials`).map(file => JSON.parse(gunzipSync(readFileSync(`${root}/world/materials/${file}`)).toString()));
  for (const entry of manifest.entries) {
    const material = materials.find(m => m.metadata?.surfaceAsset === entry.id);
    assert.ok(material, `${entry.id} is actually referenced by the shipped world`);
    assert.ok(Math.abs(material.metadata.tileMetres - entry.tileMetres[0]) < .00001);
    assert.equal(material.metallic, 0, "nonmetallic road and sand");
    assert.equal(material.useRoughnessFromMetallicTextureAlpha, false);
    assert.equal(material.useRoughnessFromMetallicTextureGreen, true);
    assert.equal(material.useAmbientOcclusionFromMetallicTextureRed, true);
    for (const [slot, channel] of [["albedoTexture", "Diffuse"], ["bumpTexture", "nor_gl"], ["metallicTexture", "arm"]]) {
      const map = entry.maps.find((m: { channel: string }) => m.channel === channel), texture = material[slot];
      const file = resolve(root, "world", texture.name);
      assert.equal(file, resolve(root, "surfaces", map.path), "Babylon world-relative URL resolves to the local map");
      assert.equal(texture.gammaSpace, slot === "albedoTexture");
      assert.equal(texture.noMipmap, false);
      const bytes = readFileSync(file);
      assert.equal(bytes.length, map.bytes);
      for (const algorithm of ["md5", "sha256"]) assert.equal(createHash(algorithm).update(bytes).digest("hex"), map[algorithm]);
    }
  }
});
