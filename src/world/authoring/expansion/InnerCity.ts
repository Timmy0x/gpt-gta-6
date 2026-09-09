import type { BoundsXZ, ColliderRecord, WorldDetail } from '../../ChunkResidency';
import { INNER_CITY_BOUNDS, INNER_CITY_CONNECTIONS, INNER_CITY_GROUND, INNER_CITY_LOCATIONS, INNER_CITY_ROADS, INNER_CITY_SPAWNS, innerCityIntersections } from './innerCityLayout';

export const INNER_CITY_MATERIALS = {
  asphalt: { color: '#343b41', roughness: .95 }, pavement: { color: '#cec4ae', roughness: .94 }, curb: { color: '#dbd5c6', roughness: .91 }, grass: { color: '#798762', roughness: .94 },
  'road-white': { color: '#dfdfcf', roughness: .92 }, 'road-yellow': { color: '#ecc764', roughness: .91 }, 'glass-blue': { color: '#284f5a', roughness: .18, metallic: .42 },
  'inner-stucco-cream': { color: '#d8cdb7', roughness: .88 }, 'inner-stucco-coral': { color: '#cda89a', roughness: .9 }, 'inner-stucco-mint': { color: '#aac2b0', roughness: .9 }, 'inner-stucco-white': { color: '#dfded2', roughness: .87 },
  'inner-roof-tile': { color: '#956b55', roughness: .9 }, 'inner-roof-gravel': { color: '#818078', roughness: .96 }, 'inner-metal': { color: '#62716b', roughness: .49, metallic: .52 }, 'inner-wood': { color: '#8d765d', roughness: .86 },
  'inner-awning-green': { color: '#507b68', roughness: .82 }, 'inner-awning-red': { color: '#ab6654', roughness: .85 }, 'inner-paving-brick': { color: '#b8a18c', roughness: .91 }, 'inner-drainage-stone': { color: '#8c9380', roughness: .98 },
  'inner-window-light': { color: '#ffe1a2', roughness: .45, emissive: .55 },
} satisfies Record<string, { color: string; roughness: number; metallic?: number; emissive?: number }>;
export type InnerMaterial = keyof typeof INNER_CITY_MATERIALS;
export interface ExpansionBox { id: string; x: number; y: number; z: number; w: number; h: number; d: number; material: InnerMaterial; detail: WorldDetail; casts: boolean; }
export interface ExpansionCylinder { id: string; x: number; y: number; z: number; diameter: number; h: number; top: number; material: InnerMaterial; detail: WorldDetail; }
export interface ExpansionSign { text: string; x: number; y: number; z: number; w: number; h: number; color: string; background: string; rotation: number; }
export type ExpansionProp = { kind: 'palm'; x: number; z: number; height: number } | { kind: 'lamp'; x: number; z: number } | { kind: 'bench'; x: number; z: number; angle: number };
export interface ExpansionBuilding { id: string; bounds: BoundsXZ; height: number; kind: 'house' | 'apartment' | 'shop' | 'workshop' | 'open-market' | 'open-cafe'; enterable: boolean; }
export interface InnerCityPlan {
  id: 'vc-inner-west-v1'; bounds: typeof INNER_CITY_BOUNDS; ground: typeof INNER_CITY_GROUND;
  connectorBounds: BoundsXZ[]; roads: typeof INNER_CITY_ROADS; locations: typeof INNER_CITY_LOCATIONS; spawns: typeof INNER_CITY_SPAWNS;
  boxes: ExpansionBox[]; cylinders: ExpansionCylinder[]; signs: ExpansionSign[]; props: ExpansionProp[]; colliders: ColliderRecord[]; buildings: ExpansionBuilding[];
  futureConnections: { region: string; x: number; z: number; status: 'reserved-unbuilt' }[];
}
export interface InnerCitySink {
  box(record: ExpansionBox): void; cylinder(record: ExpansionCylinder): void; sign(record: ExpansionSign): void;
  prop(record: ExpansionProp): void; collider(record: ColliderRecord): void;
}

/** Data-only authoring recipes. Runtime imports should use innerCityLayout, not generate meshes. */
export function createInnerCityPlan(): InnerCityPlan {
  const plan: InnerCityPlan = {
    id: 'vc-inner-west-v1', bounds: INNER_CITY_BOUNDS, ground: INNER_CITY_GROUND,
    connectorBounds: INNER_CITY_CONNECTIONS.map(point => ({ minX: -450, maxX: -422, minZ: point.z - 10, maxZ: point.z + 10 })),
    roads: INNER_CITY_ROADS, locations: INNER_CITY_LOCATIONS, spawns: INNER_CITY_SPAWNS, boxes: [], cylinders: [], signs: [], props: [], colliders: [], buildings: [],
    futureConnections: [{ region: 'VC-DOWNTOWN / AM-AMBROSIA', x: -816, z: 576, status: 'reserved-unbuilt' }, { region: 'VC-AIRPORT / GR-GRASSRIVERS', x: -1032, z: 0, status: 'reserved-unbuilt' }],
  };
  let sequence = 0;
  const box = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, material: InnerMaterial, detail: WorldDetail = 'detail', casts = false) => {
    const record = { id: `inner/${name}/${sequence++}`, x, y, z, w, h, d, material, detail, casts }; plan.boxes.push(record); return record;
  };
  const collider = (record: ExpansionBox, obstacle = true, global = false) => {
    plan.colliders.push({ id: `collision/${record.id}`, x: record.x, y: record.y, z: record.z, w: record.w, h: record.h, d: record.d, global, ...(obstacle ? { obstacle: { x: record.x, z: record.z, w: record.w, d: record.d, height: record.h } } : {}) });
  };
  const solid = (...args: Parameters<typeof box>) => { const record = box(...args); collider(record); return record; };
  const floor = (name: string, x: number, z: number, w: number, d: number, material: InnerMaterial, y = .08, h = .16) => { const record = box(name, x, y, z, w, h, d, material, 'structure'); collider(record, false); return record; };
  const cylinder = (name: string, x: number, y: number, z: number, diameter: number, h: number, material: InnerMaterial, top = diameter) => plan.cylinders.push({ id: `inner/${name}/${sequence++}`, x, y, z, diameter, h, top, material, detail: 'detail' });
  const sign = (text: string, x: number, z: number, w = 12, y = 3.2) => plan.signs.push({ text, x, y, z, w, h: 1, color: '#f6ead5', background: '#426c61', rotation: 0 });
  const palm = (x: number, z: number, height = 8) => plan.props.push({ kind: 'palm', x, z, height });
  const bench = (x: number, z: number, angle = 0) => plan.props.push({ kind: 'bench', x, z, angle });

  // Ground is explicit and only fills space not already covered by the old western margin.
  for (const bounds of INNER_CITY_GROUND) {
    const record = box('ground', (bounds.minX + bounds.maxX) / 2, -.55, (bounds.minZ + bounds.maxZ) / 2, bounds.maxX - bounds.minX, 1.1, bounds.maxZ - bounds.minZ, 'grass', 'global');
    collider(record, false, true);
  }
  const intersections = innerCityIntersections();
  for (const road of INNER_CITY_ROADS) {
    const horizontal = road.z1 === road.z2;
    const points = intersections.filter(point => horizontal ? point.z === road.z1 && point.x >= road.x1 && point.x <= road.x2 : point.x === road.x1 && point.z >= road.z1 && point.z <= road.z2).sort((a, b) => horizontal ? a.x - b.x : a.z - b.z);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], length = Math.hypot(b.x - a.x, b.z - a.z) - 20, x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      box('road', x, .012, z, horizontal ? length : road.width, .024, horizontal ? road.width : length, 'asphalt', 'structure');
      for (const side of [-1, 1]) {
        const offset = side * (road.width / 2 + 1.5);
        floor('sidewalk', x + (horizontal ? 0 : offset), z + (horizontal ? offset : 0), horizontal ? length : 3, horizontal ? 3 : length, 'pavement');
        box('curb', x + (horizontal ? 0 : side * (road.width / 2 + .12)), .075, z + (horizontal ? side * (road.width / 2 + .12) : 0), horizontal ? length : .24, .15, horizontal ? .24 : length, 'curb');
      }
      for (let offset = -length / 2 + 5; offset < length / 2 - 3; offset += 9) for (const side of [-1, 1]) box('lane-mark', x + (horizontal ? offset : side * .15), .031, z + (horizontal ? side * .15 : offset), horizontal ? 4.5 : .09, .012, horizontal ? .09 : 4.5, 'road-yellow');
      if (length > 40) for (const side of [-1, 1]) {
        const along = side * Math.min(22, length / 3), away = side * (road.width / 2 + 2.5);
        plan.props.push({ kind: 'lamp', x: x + (horizontal ? along : away), z: z + (horizontal ? away : along) });
      }
    }
  }
  for (const point of intersections) {
    box('intersection', point.x, .012, point.z, 20, .024, 20, 'asphalt', 'structure');
    for (const side of [-1, 1]) for (const offset of [-4.5, -2.25, 0, 2.25, 4.5]) {
      box('crosswalk', point.x + offset, .038, point.z + side * 8.2, 1.1, .012, 2.6, 'road-white');
      box('crosswalk', point.x + side * 8.2, .039, point.z + offset, 2.6, .012, 1.1, 'road-white');
    }
  }

  const walls: InnerMaterial[] = ['inner-stucco-cream', 'inner-stucco-coral', 'inner-stucco-mint', 'inner-stucco-white'];
  const building = (name: string, x: number, z: number, w: number, d: number, floors: number, style: number, kind: ExpansionBuilding['kind'] = 'house') => {
    const height = floors * 3.2 + .35, wall = walls[style % walls.length];
    const body = solid(name, x, height / 2 + .16, z, w, height, d, wall, 'structure', true);
    plan.buildings.push({ id: body.id, bounds: { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 }, height, kind, enterable: false });
    box('roof-slab', x, height + .34, z, w + .5, .3, d + .5, style % 2 ? 'inner-roof-tile' : 'inner-roof-gravel', 'structure', true);
    for (const side of [-1, 1]) {
      box('parapet', x + side * w / 2, height + .67, z, .3, .65, d + .4, wall, 'detail', true);
      box('parapet', x, height + .67, z + side * d / 2, w, .65, .3, wall, 'detail', true);
      for (let floorIndex = 0; floorIndex < floors; floorIndex++) {
        const y = 1.95 + floorIndex * 3.2;
        box('floor-trim', x, y + 1.22, z + side * (d / 2 + .08), w + .2, .18, .25, 'inner-stucco-white');
        for (let offset = -w / 2 + 2.5; offset < w / 2 - 1.5; offset += 3.6) {
          const lit = (Math.round(x + z + offset) + floorIndex) % 7 === 0;
          box('window-frame', x + offset, y, z + side * (d / 2 + .045), 1.92, 1.7, .16, 'inner-stucco-white');
          box('window', x + offset, y, z + side * (d / 2 + .14), 1.62, 1.4, .055, lit ? 'inner-window-light' : 'glass-blue');
          box('window-mullion', x + offset, y, z + side * (d / 2 + .18), .055, 1.42, .06, 'inner-metal');
          box('window-shade', x + offset, y + 1, z + side * (d / 2 + .42), 2.2, .14, .9, wall, 'detail', true);
        }
        for (let offset = -d / 2 + 3; offset < d / 2 - 1.5; offset += 4.2) {
          box('side-window-frame', x + side * (w / 2 + .06), y, z + offset, .18, 1.7, 1.92, 'inner-stucco-white');
          box('side-window', x + side * (w / 2 + .16), y, z + offset, .06, 1.4, 1.62, 'glass-blue');
        }
      }
    }
    // Closed houses have visible front doors but no false enterable marker.
    box('door-frame', x, 1.36, z - d / 2 - .14, 1.34, 2.4, .2, 'inner-stucco-white');
    box('door', x, 1.31, z - d / 2 - .26, 1.02, 2.1, .08, 'inner-wood');
    floor('front-step', x, z - d / 2 - 1.6, 4.4, 2.5, 'pavement');
    box('porch-shade', x, 2.85, z - d / 2 - 1.6, 4.6, .2, 3.2, style % 2 ? 'inner-awning-red' : 'inner-awning-green', 'detail', true);
    box('roof-aircon', x + w * .2, height + .82, z + d * .2, 1.55, .68, 1.3, 'inner-metal');
    for (let vent = 0; vent < 5; vent++) box('aircon-fin', x + w * .2 - .58 + vent * .29, height + 1.18, z + d * .2, .08, .04, 1.04, 'inner-roof-gravel');
  };
  const houseBlock = (x: number, z: number, variant: number) => {
    for (const dx of [-24, 24]) for (const dz of [-23, 23]) {
      building('courtyard-house', x + dx, z + dz, 18 + variant % 3 * 2, 17, variant % 4 === 0 ? 2 : 1, variant++);
      floor('home-walk', x + dx, z + dz - 15.8, 2.2, 13, 'pavement');
      box('garden-bed', x + dx - 13, .12, z + dz, 4.5, .24, 20, 'inner-drainage-stone');
      palm(x + dx + 13.5, z + dz + 7, 6.5 + variant % 3);
    }
    floor('rear-service-alley', x, z, 4.5, 88, 'pavement', .025, .05);
    for (const side of [-1, 1]) bench(x + side * 5, z + side * 8, side < 0 ? Math.PI / 2 : -Math.PI / 2);
  };

  // Named public courts deliberately interrupt the residential subdivision.
  const special = new Set(['-762,54', '-870,162', '-762,-162', '-654,378']);
  let variant = 0;
  for (const x of [-978, -870, -762, -654]) for (const z of [-162, -54, 54, 162, 270, 378]) {
    if (!special.has(`${x},${z}`)) houseBlock(x, z, variant++);
  }
  const marketX = -762, marketZ = 54;
  floor('market-court', marketX, marketZ, 84, 82, 'inner-paving-brick');
  for (const side of [-1, 1]) {
    building('market-shop', marketX + side * 30, marketZ + 12, 17, 45, 1, side < 0 ? 1 : 2, 'shop');
    for (const offset of [-14, 0, 14]) {
      const x = marketX + side * 15, z = marketZ + offset;
      for (const dx of [-3, 3]) for (const dz of [-2.5, 2.5]) solid('market-stall-post', x + dx, 1.55, z + dz, .16, 2.8, .16, 'inner-wood');
      box('market-stall-canopy', x, 3.03, z, 7, .22, 6, side < 0 ? 'inner-awning-red' : 'inner-awning-green', 'detail', true);
      solid('market-stall-counter', x, .73, z + 1.8, 5.7, 1.1, 1, 'inner-wood');
      for (const offset of [-1.6, 0, 1.6]) box('market-produce-box', x + offset, 1.5, z + 1.8, 1.3, .35, .8, 'inner-stucco-coral');
    }
    palm(marketX + side * 29, marketZ - 32, 9); bench(marketX + side * 7, marketZ - 30);
  }
  plan.buildings.push({ id: 'inner/mercado-luna', bounds: { minX: -804, maxX: -720, minZ: 13, maxZ: 95 }, height: 4.2, kind: 'open-market', enterable: true });
  sign('MERCADO LUNA', marketX, marketZ - 39, 19, 4.3);

  // Café has a real 4 m opening and an accessible furnished covered room.
  const cafeX = -870, cafeZ = 180;
  floor('cafe-court', cafeX, 162, 86, 82, 'inner-paving-brick');
  const cafeW = 29, cafeD = 20, wallY = 2.06;
  solid('cafe-back-wall', cafeX, wallY, cafeZ + 10, cafeW, 3.8, .35, 'inner-stucco-cream', 'structure', true);
  for (const side of [-1, 1]) {
    solid('cafe-side-wall', cafeX + side * 14.5, wallY, cafeZ, .35, 3.8, cafeD, 'inner-stucco-cream', 'structure', true);
    solid('cafe-front-pier', cafeX + side * 8.25, wallY, cafeZ - 10, 12.5, 3.8, .35, 'inner-stucco-cream', 'structure', true);
    box('cafe-front-glazing', cafeX + side * 8.25, 2, cafeZ - 10.22, 9.5, 2.2, .04, 'glass-blue');
  }
  const cafeRoof = box('cafe-roof', cafeX, 4.12, cafeZ, 30, .28, 21.5, 'inner-roof-gravel', 'structure', true);
  collider(cafeRoof, false); // Roof collision must not block the entire café in 2D navigation.
  solid('cafe-counter', cafeX, .8, cafeZ + 6.7, 18, 1.3, 1.3, 'inner-wood');
  for (const x of [cafeX - 7, cafeX + 7]) for (const z of [cafeZ - 3, cafeZ + 3]) {
    cylinder('cafe-table', x, .87, z, 1.6, .12, 'inner-wood'); cylinder('table-pedestal', x, .5, z, .13, .72, 'inner-metal');
    for (const side of [-1, 1]) bench(x + side * 1.6, z, side < 0 ? Math.PI / 2 : -Math.PI / 2);
  }
  for (const x of [cafeX - 26, cafeX + 26]) { palm(x, 145, 8.6); bench(x, 155); }
  plan.buildings.push({ id: 'inner/cafe-lucero', bounds: { minX: -884.5, maxX: -855.5, minZ: 170, maxZ: 190 }, height: 4.3, kind: 'open-cafe', enterable: true });
  sign('CAFÉ LUCERO', cafeX, cafeZ - 10.4, 15, 3.2);

  floor('motor-court', -762, -162, 85, 86, 'asphalt', .025, .05);
  for (const side of [-1, 1]) {
    building('motor-workshop', -762 + side * 28, -149, 21, 39, 2, side < 0 ? 0 : 2, 'workshop');
    for (let i = 0; i < 5; i++) box('parking-space', -762 + side * 25, .059, -193 + i * 3, 5.8, .01, .1, 'road-white');
    solid('motor-yard-rack', -762 + side * 33, 1.25, -190, 6, 2.2, 2, 'inner-metal');
  }
  sign('PALMA MOTOR COURT', -762, -202, 22, 3.4);

  // A northern apartment court offers another silhouette and a drive-through square.
  floor('apartment-square', -654, 378, 84, 84, 'inner-paving-brick');
  for (const side of [-1, 1]) building('apartment-wing', -654 + side * 29, 384, 17, 48, 4, side < 0 ? 2 : 0, 'apartment');
  for (const z of [352, 366, 390, 404]) { palm(-654, z, 10); bench(-644, z); }
  sign('PASEO NORTE', -654, 343, 17, 3.1);

  // Long dry swales and gardens use the actual ground datum; no invented swim zone.
  floor('garden-loop-west', -1005, 504, 3.5, 116, 'pavement');
  floor('garden-loop-east', -847, 504, 3.5, 116, 'pavement');
  for (const z of [447, 561]) floor('garden-loop-crossing', -926, z, 162, 3.5, 'pavement');
  floor('garden-central-path', -926, 504, 162, 4, 'pavement');
  for (const x of [-980, -946, -912, -878]) {
    box('dry-drainage-bed', x, .025, 488, 16, .05, 56, 'inner-drainage-stone');
    floor('drainage-footbridge', x, 504, 20, 4, 'inner-wood', .17, .12);
    for (const z of [460, 544]) { palm(x, z, 8 + (x % 3 + 3) / 3); bench(x + 6, z, Math.PI / 2); }
  }
  // Keep the named spawn on a clear public path between drainage beds.
  floor('garden-entry-path', -978, 483, 5, 44, 'pavement');
  sign('WEST DRAINAGE GARDENS', -930, 443, 28, 2.2);
  for (const x of [-764, -676]) {
    building('north-boulevard-apartments', x, 523, 52, 34, 5, x < -700 ? 3 : 1, 'apartment');
    floor('north-court-forecourt', x, 481, 68, 32, 'inner-paving-brick');
    for (const side of [-1, 1]) { palm(x + side * 24, 472, 9); bench(x + side * 12, 486); }
  }

  // The eastern connector frontage stays south/north of the existing reserve annex.
  for (const [x, z] of [[-528, -262], [-528, -145], [-528, -55], [-528, 273]]) {
    building('connector-frontage', x, z, 50, 27, z < -230 ? 2 : 3, Math.abs(z) % 4, z < -230 ? 'workshop' : 'shop');
    floor('connector-service-court', x, z - 24, 72, 16, 'pavement');
    for (const side of [-1, 1]) palm(x + side * 32, z - 26, 8.3);
  }
  for (const point of INNER_CITY_CONNECTIONS) sign('WEST VICE CITY  /  MERCADO LUNA', -477, point.z - 13, 20, 4.8);
  return plan;
}

/** Root WorldBuilder supplies existing PBR/batching/prop and collider sinks. */
export function emitInnerCity(plan: InnerCityPlan, sink: InnerCitySink): void {
  for (const record of plan.boxes) sink.box(record);
  for (const record of plan.cylinders) sink.cylinder(record);
  for (const record of plan.signs) sink.sign(record);
  for (const record of plan.props) sink.prop(record);
  for (const record of plan.colliders) sink.collider(record);
}
