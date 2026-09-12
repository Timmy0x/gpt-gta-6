import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectAerometrexDelivery, type AerometrexDelivery } from '../scripts/world/miami/aerometrex/inspect-delivery';

const descriptor: AerometrexDelivery = { version: 1, provider: 'Aerometrex', id: 'synthetic-test-only', capture: 'test', source: 'test fixture; not Miami data', use: 'personal-local', format: 'obj', models: ['tile/model.obj'], coordinateMetadata: 'coordinates.json', accessRecord: 'access.txt' };
const records = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 1\n';
const valid = `mtllib surface.mtl\n${records}usemtl surface\nf 1/1/1 2/2/1 3/3/1\n`;
const material = 'newmtl surface\nmap_Kd color.png\n';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6i8AAAAASUVORK5CYII=', 'base64');
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'aerometrex-delivery-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'tile'));
  await Promise.all([writeFile(join(root, 'coordinates.json'), '{}'), writeFile(join(root, 'access.txt'), 'Synthetic fixture only'), writeFile(join(root, 'tile/model.obj'), valid), writeFile(join(root, 'tile/surface.mtl'), material), writeFile(join(root, 'tile/color.png'), png)]);
  return root;
}

test('private delivery inventories exact files and per-model geometry without claiming an import', async t => {
  const root = await fixture(t), result = await inspectAerometrexDelivery(root, descriptor);
  assert.equal(result.vertices, 3); assert.equal(result.faces, 1); assert.equal(result.textureReferences, 1); assert.equal(result.files.length, 5);
  assert.deepEqual(result.models, [{ path: 'tile/model.obj', vertices: 3, textureCoordinates: 3, normals: 1, faces: 1, texturedFaces: 1 }]);
  for (const file of result.files) {
    const bytes = await readFile(join(root, file.path)); assert.equal(file.bytes, bytes.length);
    assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(result.use, 'personal-local'); assert.match(result.status, /Texture decoding.*acceptance remain required/);
  await rm(join(root, 'tile/color.png'));
  await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /ENOENT/);
});

test('containment checks apply to materials, textures, symlinks and portable path syntax', async t => {
  const root = await fixture(t), outside = await mkdtemp(join(tmpdir(), 'aerometrex-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true })); await writeFile(join(outside, 'image.png'), png);
  await symlink(join(outside, 'image.png'), join(root, 'tile/escaped.png'));
  await writeFile(join(root, 'tile/surface.mtl'), 'newmtl surface\nmap_Kd escaped.png\n');
  await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /escapes/);
  await symlink(outside, join(root, 'outside-link'));
  await writeFile(join(outside, 'surface.mtl'), material);
  await writeFile(join(root, 'tile/model.obj'), valid.replace('surface.mtl', '../outside-link/surface.mtl'));
  await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /escapes/);
  await writeFile(join(root, 'tile/model.obj'), valid);
  for (const path of ['https://example.invalid/private.png', 'C:\\private\\image.png', '\\\\server\\share\\image.png', '/absolute/image.png']) {
    await writeFile(join(root, 'tile/surface.mtl'), `newmtl surface\nmap_Kd ${path}\n`);
    await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /local relative/, path);
  }
  await writeFile(join(root, 'tile/surface.mtl'), material);
  await assert.rejects(() => inspectAerometrexDelivery(root, { ...descriptor, coordinateMetadata: 'https://example.invalid/private.json' }), /local relative/);
  await assert.rejects(() => inspectAerometrexDelivery(root, { ...descriptor, coordinateMetadata: 'tile' }), /not a file/);
});

test('reflection and spectral dependencies cannot disappear from the inventory', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'tile/surface.mtl'), material + 'refl missing-reflection.png\n');
  await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /missing-reflection/);
  await writeFile(join(root, 'tile/environment.png'), png);
  await writeFile(join(root, 'tile/surface.mtl'), material + 'refl environment.png\n');
  const result = await inspectAerometrexDelivery(root, descriptor);
  assert.equal(result.textureReferences, 2); assert.ok(result.files.some(file => file.path === 'tile/environment.png'));
  for (const statement of ['refl -type sphere missing.png', 'map_Kd -s 2 2 1 color.png']) {
    await writeFile(join(root, 'tile/surface.mtl'), material + statement + '\n');
    await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /explicit conversion/, statement);
  }
  await writeFile(join(root, 'tile/surface.mtl'), material + 'Ka spectral missing.rfl 1\n');
  await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /Spectral-file dependencies/);
});

test('unknown external or non-polygon grammar fails explicitly', async t => {
  const root = await fixture(t);
  for (const command of ['call outside.obj', 'csh unwanted-command', 'maplib another.map', 'shadow_obj another.obj', 'trace_obj another.obj', 'vp 1 2 3', 'curv 0 1 1 2 3']) {
    await writeFile(join(root, 'tile/model.obj'), valid + command + '\n');
    await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /Unsupported OBJ statement/, command);
  }
  await writeFile(join(root, 'tile/model.obj'), valid);
  await writeFile(join(root, 'tile/surface.mtl'), material + 'include another.mtl\n');
  await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /Unsupported MTL statement/);
});

test('finite vertex, UV and normal records are required independently for each OBJ', async t => {
  const root = await fixture(t);
  const cases = [
    ['v 0 0 0', 'v invalid', /finite numeric/], ['v 0 0 0', 'v NaN 0 0', /finite numeric/],
    ['v 0 0 0', 'v 1e999 0 0', /finite numeric/], ['v 0 0 0', 'v 0 0 0 0', /weight/],
    ['vt 0 0', 'vt 0 Infinity', /finite numeric/], ['vn 0 0 1', 'vn 0 0 0', /nonzero length/],
    ['vn 0 0 1', 'vn 0 1', /finite numeric/],
  ] as const;
  for (const [before, after, error] of cases) {
    await writeFile(join(root, 'tile/model.obj'), valid.replace(before, after));
    await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), error, after);
  }
  await writeFile(join(root, 'tile/model.obj'), valid);
  await writeFile(join(root, 'tile/empty.obj'), 'mtllib surface.mtl\n');
  await assert.rejects(() => inspectAerometrexDelivery(root, { ...descriptor, models: [...descriptor.models, 'tile/empty.obj'] }), /no polygon surface/);
  await assert.rejects(() => inspectAerometrexDelivery(root, { ...descriptor, models: [...descriptor.models, 'tile/model.obj'] }), /more than once/);
});

test('face indices cannot reference absent records or omit a textured material binding', async t => {
  const root = await fixture(t);
  const faces = [
    '0/1 2/2 3/3', '4/1 2/2 3/3', '-4/1 -2/2 -1/3', '1/4 2/2 3/3',
    '1/1/2 2/2/1 3/3/1', '1/1/0 2/2/1 3/3/1', '1/1.5 2/2 3/3',
    '9007199254740993/1 2/2 3/3', '1/1/ 2/2/1 3/3/1', '1//1 2//1 3//1',
    '1 2 3', '1/1 2/2', '1/1 1/2 2/3', 'nonexistent',
  ];
  for (const face of faces) {
    await writeFile(join(root, 'tile/model.obj'), `mtllib surface.mtl\n${records}usemtl surface\nf ${face}\n`);
    await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /index|indices|vertices|syntax/, face);
  }
  await writeFile(join(root, 'tile/model.obj'), valid.replace('usemtl surface\n', ''));
  await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /usemtl binding/);
  await writeFile(join(root, 'tile/model.obj'), valid.replace('usemtl surface', 'usemtl missing'));
  await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /Unknown material/);
  await writeFile(join(root, 'tile/model.obj'), valid.replace('f 1/1/1 2/2/1 3/3/1', 'f -3/-3/-1 -2/-2/-1 -1/-1/-1'));
  assert.equal((await inspectAerometrexDelivery(root, descriptor)).faces, 1);
});

test('multiple material libraries resolve separately and preserve first-library lookup order', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'tile/second.mtl'), 'newmtl second\nmap_Kd color.png\nnewmtl surface\nKd 1 1 1\n');
  await writeFile(join(root, 'tile/model.obj'), valid.replace('mtllib surface.mtl', 'mtllib surface.mtl second.mtl') + 'usemtl second\nf 1/1 2/2 3/3\n');
  const result = await inspectAerometrexDelivery(root, descriptor);
  assert.equal(result.faces, 2); assert.equal(result.models[0].texturedFaces, 2);
  assert.equal(result.files.filter(file => file.role === 'material').length, 2);
  assert.equal(result.files.filter(file => file.role === 'texture').length, 1);
});

test('spaced filenames must not be confused with an mtllib list', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'tile/surface.mtl second.mtl'), material);
  await writeFile(join(root, 'tile/second.mtl'), 'newmtl second\nmap_Kd color.png\n');
  await writeFile(join(root, 'tile/model.obj'), valid.replace('mtllib surface.mtl', 'mtllib surface.mtl second.mtl'));
  await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /Ambiguous mtllib/);
  await writeFile(join(root, 'tile/texture #1.png'), png);
  await writeFile(join(root, 'tile/surface.mtl second.mtl'), 'newmtl surface\nmap_Kd "texture #1.png"\n');
  await writeFile(join(root, 'tile/model.obj'), valid.replace('mtllib surface.mtl', 'mtllib "surface.mtl second.mtl" second.mtl'));
  const result = await inspectAerometrexDelivery(root, descriptor);
  assert.ok(result.files.some(file => file.path === 'tile/surface.mtl second.mtl'));
  assert.ok(result.files.some(file => file.path === 'tile/texture #1.png'));
});

test('shared material aliases retain texture dependencies from both tile folders', async t => {
  const root = await fixture(t); await mkdir(join(root, 'other'));
  await writeFile(join(root, 'shared.mtl'), material);
  await rm(join(root, 'tile/surface.mtl'));
  await symlink('../shared.mtl', join(root, 'tile/surface.mtl'));
  await symlink('../shared.mtl', join(root, 'other/surface.mtl'));
  await writeFile(join(root, 'other/model.obj'), valid);
  await writeFile(join(root, 'other/color.png'), png);
  const both = { ...descriptor, models: ['tile/model.obj', 'other/model.obj'] };
  const result = await inspectAerometrexDelivery(root, both);
  assert.equal(result.files.filter(file => file.role === 'material').length, 1);
  assert.equal(result.files.filter(file => file.role === 'texture').length, 2);
  await rm(join(root, 'other/color.png'));
  await assert.rejects(() => inspectAerometrexDelivery(root, both), /ENOENT/);
});

test('portable relative Windows paths, comments and continuations retain their dependencies', async t => {
  const root = await fixture(t); await mkdir(join(root, 'tile/materials'));
  await writeFile(join(root, 'tile/materials/surface.mtl'), 'newmtl surface\nKa xyz 0.1 0.2 0.3\nmap_aat on\nmap_Kd ..\\color.png # source texture\n');
  await writeFile(join(root, 'tile/model.obj'), valid.replace('mtllib surface.mtl', 'mtllib materials\\surface.mtl # material').replace('f 1/1/1 2/2/1 3/3/1', 'f 1/1/1 \\\n 2/2/1 3/3/1 # face'));
  const result = await inspectAerometrexDelivery(root, descriptor);
  assert.equal(result.faces, 1); assert.equal(result.textureReferences, 1);
  await writeFile(join(root, 'tile/model.obj'), valid + 'f 1/1 \\');
  await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /Unfinished line continuation/);
});

test('empty files, invalid descriptor shapes and oversized lines fail before success', async t => {
  const root = await fixture(t);
  await assert.rejects(() => inspectAerometrexDelivery(root, { ...descriptor, models: 'tile/model.obj' } as unknown as AerometrexDelivery), /required/);
  await writeFile(join(root, 'access.txt'), '');
  await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /file is empty/);
  await writeFile(join(root, 'access.txt'), 'Synthetic fixture');
  await writeFile(join(root, 'tile/model.obj'), '#' + 'x'.repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(() => inspectAerometrexDelivery(root, descriptor), /line exceeds inspection limit/);
});
