import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const source = await readFile('data/lighting/wide_street_02_1k.hdr');
const metadata = JSON.parse(await readFile('data/lighting/files.json', 'utf8')).hdri['1k'].hdr;
assert.equal(createHash('md5').update(source).digest('hex'), metadata.md5);
const server = await createServer({ root: process.cwd(), optimizeDeps: { include: ['@babylonjs/core/Misc/environmentTextureTools'] }, server: { host: '127.0.0.1', port: 4185, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4185/scripts/world/export.html');
  const result = await page.evaluate(async () => (await import('/scripts/assets/prepare-lighting.ts')).prepareLighting());
  assert.equal(errors.length, 0); assert.equal(result.engine, 2); assert.equal(result.info.width, 256);
  const output = Buffer.from(result.base64, 'base64');
  await mkdir('public/lighting', { recursive: true });
  await writeFile('public/lighting/coastal-street.env', output);
  const provenance = {
    asset: 'Wide Street 02', author: 'Sergej Majboroda', publisher: 'Poly Haven', license: 'CC0-1.0',
    sourcePage: 'https://polyhaven.com/a/wide_street_02', licenseUrl: 'https://polyhaven.com/license',
    sourceUrl: metadata.url, sourceBytes: source.length, sourceSha256: createHash('sha256').update(source).digest('hex'),
    outputBytes: output.length, outputSha256: createHash('sha256').update(output).digest('hex'),
    conversion: 'Babylon.js 9.25.0 HDRCubeTexture, 256px faces, linear radiance, harmonics and prefiltered mip chain; CreateEnvTextureAsync PNG RGBD output.',
    use: 'Generic urban lighting/reflection reference; not a Leonida/Miami geography source or live scene reflection.',
    verification: { errors, engine: result.engine, info: result.info },
  };
  await writeFile('public/lighting/provenance.json', JSON.stringify(provenance, null, 2));
  console.log(JSON.stringify({ bytes: output.length, sha256: provenance.outputSha256, width: result.info.width, errors }));
} finally { await browser.close(); await server.close(); }
