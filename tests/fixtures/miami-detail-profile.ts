import { readFile } from 'node:fs/promises';
import { MeshBuilder, Scene, UniversalCamera, Vector3 } from '@babylonjs/core';
import { FramebufferEngine } from './miami-tile-view';
import { StreamedMiamiVisuals, MIAMI_VISUAL_ORIGIN, type VisualDetailProfile, type VisualSnapshot } from '../../src/world/miami/visuals/StreamedMiamiVisuals';
import type { VisualFetch } from '../../src/world/miami/visuals/ScopedProviderTransport';

const originalRoot = JSON.parse(await readFile(new URL('../../tools/miami-lh-renderer/fixtures/geographic/nested-z/tileset.json', import.meta.url), 'utf8'));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
/** Independently authored three-vertex content, not provider geometry or imagery. */
export function detailGlb(label: string, unsupported = false): Uint8Array<ArrayBuffer> {
  const binary = new Uint8Array(44), positions = new Float32Array(binary.buffer, 0, 9);
  positions.set([-2, 0, 0, 2, 0, 0, 0, 3, 0]); new Uint16Array(binary.buffer, 36, 3).set([0, 1, 2]);
  const json = {
    asset: { version: '2.0', copyright: `Original synthetic ${label} credit` }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: label, mesh: 0 }], meshes: [{ name: label, primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: binary.byteLength }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-2, 0, 0], max: [2, 3, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
    ...(unsupported ? { extensionsUsed: ['KHR_draco_mesh_compression'] } : {}),
  };
  const text = new TextEncoder().encode(JSON.stringify(json)), padded = (text.length + 3) & ~3;
  const glb = new Uint8Array(12 + 8 + padded + 8 + binary.length), view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, glb.length, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true); glb.fill(32, 20, 20 + padded); glb.set(text, 20);
  view.setUint32(20 + padded, binary.length, true); view.setUint32(24 + padded, 0x004e4942, true); glb.set(binary, 28 + padded);
  return glb;
}

function local(ecef: number[]): Vector3 {
  const lat = MIAMI_VISUAL_ORIGIN.latitudeDegrees * Math.PI / 180, lon = MIAMI_VISUAL_ORIGIN.longitudeDegrees * Math.PI / 180;
  const a = 6378137, b = 6356752.314245179, n = a * a / Math.sqrt(a * a * Math.cos(lat) ** 2 + b * b * Math.sin(lat) ** 2);
  const origin = [n * Math.cos(lat) * Math.cos(lon), n * Math.cos(lat) * Math.sin(lon), b * b / (a * a) * n * Math.sin(lat)], d = ecef.map((v, i) => v - origin[i]);
  return new Vector3(...[[-Math.sin(lon), Math.cos(lon), 0], [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)], [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)]].map(axis => axis.reduce((s, v, i) => s + v * d[i], 0)) as [number, number, number]);
}

export interface DetailRequest { url: URL; init: RequestInit; }
export interface DetailFixtureOptions {
  profile?: VisualDetailProfile;
  fanout?: number;
  ion?: boolean;
  route?: (request: DetailRequest, ordinary: () => Response) => Promise<Response> | Response;
}
export function detailFixture(options: DetailFixtureOptions = {}) {
  const engine = new FramebufferEngine(), scene = new Scene(engine);
  engine.framebufferWidth = 1280; engine.framebufferHeight = 720;
  const center = local(originalRoot.root.transform.slice(12, 15));
  const camera = new UniversalCamera('existing-detail-game-camera', center.add(new Vector3(0, 4, -120)), scene);
  camera.setTarget(center); camera.fov = .88; camera.minZ = .12; camera.maxZ = 1500;
  const existingObject = MeshBuilder.CreateBox('existing-physical-game-object', {}, scene);
  existingObject.position.copyFrom(center.add(new Vector3(50, 0, 0)));
  const tile = (level: number, suffix = ''): Record<string, unknown> => ({
    boundingVolume: { sphere: [0, 0, 0, 12] }, geometricError: [2.2, 1.35, 0][level], refine: 'REPLACE',
    content: { uri: `level-${level}${suffix}.glb?session=fixture-detail-session` },
    children: level === 2 ? [] : [tile(level + 1)],
  });
  const root = tile(0); root.transform = [...originalRoot.root.transform];
  if (options.fanout) root.children = Array.from({ length: options.fanout }, (_, i) => ({ boundingVolume: { sphere: [0, 0, 0, 12] }, geometricError: 0, content: { uri: `leaf-${i}.glb?session=fixture-detail-session` }, children: [] }));
  const rootJSON = { asset: { version: '1.0', gltfUpAxis: 'Y' }, geometricError: 2.2, root };
  const requests: DetailRequest[] = [], changes: VisualSnapshot[] = [];
  const fetcher: VisualFetch = async (input, init = {}) => {
    const request = { url: new URL(String(input)), init }; requests.push(request);
    const ordinary = () => {
      if (request.url.host === 'api.cesium.com') return new Response(JSON.stringify({ type: '3DTILES', externalType: '3DTILES', options: { url: 'https://tile.googleapis.com/v1/3dtiles/root.json?key=fixture-detail-issued-key' }, attributions: [{ html: 'Original synthetic endpoint credit' }] }));
      if (request.url.pathname.endsWith('/root.json')) return new Response(JSON.stringify(rootJSON));
      const label = request.url.pathname.split('/').at(-1)!.replace('.glb', '');
      return new Response(detailGlb(label));
    };
    return options.route ? options.route(request, ordinary) : ordinary();
  };
  const visuals = new StreamedMiamiVisuals(scene, { fetch: fetcher, detailProfile: options.profile, onChange: value => changes.push(value) });
  let now = 10000;
  const step = async (frames = 1) => { for (let i = 0; i < frames; i++) { visuals.update(now); now += 17; await tick(); } };
  const pump = async (predicate: () => boolean, frames = 500) => { for (let i = 0; i < frames && !predicate(); i++) await step(); return predicate(); };
  const visible = () => scene.meshes.filter(mesh => mesh !== existingObject && mesh.getTotalVertices() > 0 && mesh.isEnabled()).map(mesh => mesh.name).sort();
  return { engine, scene, center, camera, visuals, requests, changes, existingObject, step, pump, visible,
    connect() { visuals.connect(options.ion ? { provider: 'ion', credential: 'fixture-detail-private-token', assetId: '2275207' } : { provider: 'google', credential: 'fixture-detail-private-key' }); },
    dispose() { visuals.dispose(); scene.dispose(); engine.dispose(); } };
}
