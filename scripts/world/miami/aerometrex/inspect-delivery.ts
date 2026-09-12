import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface DeliveryFile { path: string; bytes: number; sha256: string; role: 'model' | 'material' | 'texture' | 'reference'; }
export interface AerometrexDelivery {
  version: 1; provider: 'Aerometrex'; id: string; capture: string; source: string;
  use: 'personal-local'; format: 'obj'; models: string[]; coordinateMetadata: string; accessRecord: string;
}
interface SourceFile { path: string; absolute: string; logical: string; size: number; mtimeMs: number; ctimeMs: number; }
interface Material { name: string; textured: boolean; }
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const integer = /^[+-]?\d+$/;
function fail(file: string, line: number, message: string): never { throw new Error(`${file}:${line}: ${message}`); }
function numbers(text: string, min: number, max: number, file: string, line: number) {
  const words = text.split(/\s+/);
  if (words.length < min || words.length > max || words.some(v => !numeric.test(v) || !Number.isFinite(Number(v)))) fail(file, line, 'Expected finite numeric values with supported component count');
  return words.map(Number);
}
/** OBJ/MTL comments and continuations; quoted filenames retain spaces and '#'. */
async function* lines(file: SourceFile) {
  let pending = '', logical = '', physicalLine = 0, start = 1;
  const clean = (raw: string) => {
    let quote = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '#') return raw.slice(0, i).trim();
    }
    if (quote) fail(file.path, physicalLine, 'Unclosed quoted filename');
    return raw.trim();
  };
  function consume(raw: string) {
    physicalLine++;
    if (!logical) start = physicalLine;
    const text = clean(raw), continued = text.endsWith('\\');
    logical += (continued ? text.slice(0, -1) : text) + (continued ? ' ' : '');
    if (Buffer.byteLength(logical) > MAX_LINE_BYTES) fail(file.path, start, 'Logical line exceeds inspection limit');
    if (continued) return undefined;
    const result = { text: logical.trim(), line: start }; logical = ''; return result;
  }
  for await (const chunk of createReadStream(file.absolute, { encoding: 'utf8' })) {
    pending += chunk;
    let end: number;
    while ((end = pending.indexOf('\n')) >= 0) {
      if (Buffer.byteLength(pending.slice(0, end)) > MAX_LINE_BYTES) fail(file.path, physicalLine + 1, 'Physical line exceeds inspection limit');
      const result = consume(pending.slice(0, end).replace(/\r$/, '')); pending = pending.slice(end + 1);
      if (result?.text) yield result;
    }
    if (Buffer.byteLength(pending) > MAX_LINE_BYTES) fail(file.path, physicalLine + 1, 'Physical line exceeds inspection limit');
  }
  if (pending) { const result = consume(pending); if (result?.text) yield result; }
  if (logical) fail(file.path, start, 'Unfinished line continuation');
}
function statement(text: string) { const at = text.search(/\s/); return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at).trim()]; }
function filenameList(text: string, file: string, line: number) {
  const result: string[] = []; let at = 0;
  while (at < text.length) {
    while (/\s/.test(text[at] ?? '') && at < text.length) at++;
    if (at === text.length) break;
    if (text[at] === '"' || text[at] === "'") {
      const quote = text[at++], end = text.indexOf(quote, at);
      if (end < 0) fail(file, line, 'Unclosed quoted filename');
      result.push(text.slice(at, end)); at = end + 1;
      if (at < text.length && !/\s/.test(text[at])) fail(file, line, 'Separate quoted filenames with whitespace');
    } else {
      const start = at; while (at < text.length && !/\s/.test(text[at])) at++;
      const value = text.slice(start, at);
      if (/["']/.test(value)) fail(file, line, 'Quote the entire filename when it contains spaces');
      result.push(value);
    }
  }
  if (!result.length || result.some(value => !value)) fail(file, line, 'A filename is required');
  return result;
}
function localPath(path: string) {
  if (typeof path !== 'string' || !path.trim() || path.includes('\0')) throw new Error('Delivery paths must be nonempty local relative strings');
  const normalized = path.replace(/\\/g, '/');
  if (isAbsolute(normalized) || /^[a-z][a-z\d+.-]*:/i.test(normalized)) throw new Error(`Delivery must use local relative paths: ${path}`);
  return normalized;
}

/** Inventory a private OBJ package. No network, import, texture decoding or geographic acceptance. */
export async function inspectAerometrexDelivery(directory: string, descriptor: AerometrexDelivery) {
  if (!descriptor || descriptor.version !== 1 || descriptor.provider !== 'Aerometrex' || descriptor.use !== 'personal-local' || descriptor.format !== 'obj') throw new Error('Expected a personal, local Aerometrex OBJ delivery descriptor');
  if (['id', 'capture', 'source', 'coordinateMetadata', 'accessRecord'].some(key => typeof descriptor[key as keyof AerometrexDelivery] !== 'string' || !(descriptor[key as keyof AerometrexDelivery] as string).trim()) || !Array.isArray(descriptor.models) || !descriptor.models.length || descriptor.models.some(path => typeof path !== 'string' || !path.trim())) throw new Error('Delivery identity, capture, model files, coordinate metadata and access record are required');
  const root = await realpath(directory), files = new Map<string, DeliveryFile>(), sources = new Map<string, SourceFile>();
  const locate = async (path: string): Promise<SourceFile> => {
    const logical = resolve(root, localPath(path)), absolute = await realpath(logical), local = relative(root, absolute);
    if (local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) throw new Error('Delivery reference escapes its source directory');
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error(`Delivery reference is not a file: ${path}`);
    return { path: local.split(sep).join('/'), absolute, logical, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs };
  };
  const register = async (path: string, role: DeliveryFile['role']) => {
    const source = await locate(path), previous = files.get(source.path);
    if (previous && previous.role !== role) throw new Error(`Delivery file has conflicting roles: ${source.path}`);
    if (!previous) {
      const hash = createHash('sha256'); let bytes = 0;
      for await (const chunk of createReadStream(source.absolute)) { hash.update(chunk); bytes += chunk.length; }
      if (!bytes) throw new Error(`Delivery file is empty: ${source.path}`);
      files.set(source.path, { path: source.path, role, bytes, sha256: hash.digest('hex') }); sources.set(source.path, source);
    }
    return source;
  };
  const child = (parent: SourceFile, name: string) => relative(root, resolve(dirname(parent.logical), localPath(name)));
  const materialCache = new Map<string, Map<string, Material>>(); let textureReferences = 0;
  const readMaterials = async (file: SourceFile) => {
    // A shared MTL symlink can resolve textures relative to different tile folders.
    // Cache the reference context, while hashing each canonical source file once.
    if (materialCache.has(file.logical)) return materialCache.get(file.logical)!;
    const materials = new Map<string, Material>(); let current: Material | undefined;
    for await (const { text, line } of lines(file)) {
      const [rawCommand, args] = statement(text), command = rawCommand.toLowerCase();
      if (command === 'newmtl') {
        if (!args || materials.has(args)) fail(file.path, line, 'Material name is missing or duplicated');
        current = { name: args, textured: false }; materials.set(args, current); continue;
      }
      if (!current) fail(file.path, line, 'Material property precedes newmtl');
      if (command === 'map_aat') { if (!/^(on|off)$/i.test(args)) fail(file.path, line, 'map_aat expects on or off'); continue; }
      if (/^(map_\w+|bump|disp|decal|norm|refl)$/.test(command)) {
        if (!args || args.startsWith('-')) fail(file.path, line, 'MTL texture options require explicit conversion; dependency was not skipped');
        const name = /^["']/.test(args) ? filenameList(args, file.path, line) : [args];
        if (name.length !== 1) fail(file.path, line, 'Texture statement requires one filename');
        await register(child(file, name[0]), 'texture'); current.textured = true; textureReferences++; continue;
      }
      if (/^(ka|kd|ks|ke|tf)$/.test(command)) {
        if (/^spectral\b/i.test(args)) fail(file.path, line, 'Spectral-file dependencies require explicit conversion');
        numbers(args.replace(/^xyz\s+/i, ''), 1, 3, file.path, line); continue;
      }
      if (/^(ns|ni|tr|illum|sharpness|pr|pm|ps|pc|pcr|aniso|anisor)$/.test(command)) { numbers(args, 1, 1, file.path, line); continue; }
      if (command === 'd') { numbers(args.replace(/^-halo\s+/i, ''), 1, 1, file.path, line); continue; }
      fail(file.path, line, `Unsupported MTL statement '${rawCommand}'; explicit conversion is required`);
    }
    if (!materials.size) throw new Error(`Material library has no definitions: ${file.path}`);
    materialCache.set(file.logical, materials); return materials;
  };
  await register(descriptor.coordinateMetadata, 'reference'); await register(descriptor.accessRecord, 'reference');
  const seenModels = new Set<string>(), modelSummaries = [];
  for (const path of descriptor.models) {
    const file = await register(path, 'model');
    if (seenModels.has(file.path)) throw new Error(`Model is listed more than once: ${file.path}`);
    seenModels.add(file.path);
    const counts = { vertices: 0, textureCoordinates: 0, normals: 0, faces: 0 }, libraries: string[] = [];
    for await (const { text, line } of lines(file)) {
      const [command, args] = statement(text);
      if (command === 'v') { const values = numbers(args, 3, 4, file.path, line); if (values[3] === 0) fail(file.path, line, 'Homogeneous vertex weight cannot be zero'); counts.vertices++; }
      else if (command === 'vt') { numbers(args, 1, 3, file.path, line); counts.textureCoordinates++; }
      else if (command === 'vn') { if (numbers(args, 3, 3, file.path, line).every(v => v === 0)) fail(file.path, line, 'Normal must have nonzero length'); counts.normals++; }
      else if (command === 'f') counts.faces++;
      else if (command === 'mtllib') {
        const names = filenameList(args, file.path, line);
        // Unquoted whitespace is a standard library list, not a guessed spaced filename.
        if (names.length > 1 && !/["']/.test(args)) {
          let literal: SourceFile | undefined;
          try { literal = await locate(child(file, args)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error; }
          if (literal) fail(file.path, line, 'Ambiguous mtllib filenames; quote filenames containing spaces explicitly');
        }
        libraries.push(...names);
      } else if (command === 'usemtl') { if (!args) fail(file.path, line, 'Material name is required'); }
      else if (!['o', 'g', 's', 'bevel', 'c_interp', 'd_interp'].includes(command)) fail(file.path, line, `Unsupported OBJ statement '${command}'; external or non-polygon geometry requires explicit conversion`);
    }
    if (counts.vertices < 3 || !counts.faces || !libraries.length) throw new Error(`Model has no polygon surface or material library: ${file.path}`);
    const materials = new Map<string, Material>();
    for (const name of new Set(libraries)) {
      const library = await register(child(file, name), 'material');
      // Wavefront searches libraries in listed order; the first definition wins.
      for (const [name, material] of await readMaterials(library)) if (!materials.has(name)) materials.set(name, material);
    }
    let v = 0, vt = 0, vn = 0, active = '', texturedFaces = 0;
    const index = (value: string, current: number, final: number, kind: string, line: number) => {
      const parsed = Number(value);
      if (!integer.test(value) || !Number.isSafeInteger(parsed) || parsed === 0) fail(file.path, line, `Invalid ${kind} index`);
      const resolved = parsed < 0 ? current + parsed + 1 : parsed;
      if (resolved < 1 || resolved > (parsed < 0 ? current : final)) fail(file.path, line, `${kind} index is outside this model's available records`);
      return resolved;
    };
    for await (const { text, line } of lines(file)) {
      const [command, args] = statement(text);
      if (command === 'v') v++; else if (command === 'vt') vt++; else if (command === 'vn') vn++;
      else if (command === 'usemtl') { if (!materials.has(args)) fail(file.path, line, `Unknown material '${args}'`); active = args; }
      else if (command === 'f') {
        const material = materials.get(active); if (!material) fail(file.path, line, 'Face has no valid usemtl binding');
        const tokens = args.split(/\s+/); if (tokens.length < 3) fail(file.path, line, 'Face requires at least three vertices');
        const distinct = new Set<number>();
        for (const token of tokens) {
          const parts = token.split('/');
          if (parts.length > 3 || !parts[0] || parts.length === 2 && !parts[1] || parts.length === 3 && !parts[2]) fail(file.path, line, 'Unsupported face index syntax');
          distinct.add(index(parts[0], v, counts.vertices, 'vertex', line));
          if (parts[1]) index(parts[1], vt, counts.textureCoordinates, 'texture coordinate', line);
          else if (material.textured) fail(file.path, line, 'Textured face has no texture coordinate index');
          if (parts[2]) index(parts[2], vn, counts.normals, 'normal', line);
        }
        if (distinct.size < 3) fail(file.path, line, 'Face has fewer than three distinct vertices');
        if (material.textured) texturedFaces++;
      }
    }
    if (!texturedFaces) throw new Error(`Model has no faces bound to textured materials: ${file.path}`);
    modelSummaries.push({ path: file.path, ...counts, texturedFaces });
  }
  for (const file of sources.values()) {
    const info = await stat(file.absolute);
    if (info.size !== file.size || info.mtimeMs !== file.mtimeMs || info.ctimeMs !== file.ctimeMs) throw new Error(`Delivery file changed during inspection: ${file.path}`);
  }
  return { version: 1, provider: descriptor.provider, id: descriptor.id, capture: descriptor.capture, source: descriptor.source,
    use: descriptor.use, format: descriptor.format, vertices: modelSummaries.reduce((n, m) => n + m.vertices, 0), faces: modelSummaries.reduce((n, m) => n + m.faces, 0), textureReferences,
    models: modelSummaries, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    status: 'File inventory, supported OBJ records, material bindings and declared dependencies verified. Texture decoding, coordinate transformation, import and geographic/visual acceptance remain required.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, metadata] = process.argv.slice(2);
  if (!directory || !metadata) throw new Error('Usage: node --import tsx scripts/world/miami/aerometrex/inspect-delivery.ts PRIVATE_SOURCE_DIRECTORY DELIVERY_JSON');
  const descriptor = JSON.parse(await readFile(metadata, 'utf8')) as AerometrexDelivery;
  console.log(JSON.stringify(await inspectAerometrexDelivery(directory, descriptor), null, 2));
}
