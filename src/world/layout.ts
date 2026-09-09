import type { RoadNode, WorldLocation } from "../core/contracts";

/** All dimensions are project decisions in metres, not measured GTA VI geography. */
export const CITY_LAYOUT = {
  roadWidth: 14,
  sidewalkWidth: 3,
  blockPitch: 72,
  xStreets: [-432, -360, -288, -216, -144, -72, 0, 72, 144],
  zStreets: [-288, -216, -144, -72, 0, 72, 144, 216],
  beachStart: 155,
  shoreline: 210,
  districtBounds: { minX: -552, maxX: 210, minZ: -310, maxZ: 252 },
} as const;

/**
 * Directed lanes with separate approach and departure nodes. Lane segments remain
 * straight until the intersection, then continue or turn within its paved area.
 */
export function createLaneGraph(): RoadNode[] {
  const nodes: RoadNode[] = [];
  const directions = [
    { x: 1, z: 0, px: 0, pz: -3.3 },
    { x: 0, z: 1, px: 3.3, pz: 0 },
    { x: -1, z: 0, px: 0, pz: 3.3 },
    { x: 0, z: -1, px: -3.3, pz: 0 },
  ];
  const width = CITY_LAYOUT.xStreets.length;
  const height = CITY_LAYOUT.zStreets.length;
  const ids = new Map<string, number>();
  const key = (ix: number, iz: number, heading: number, departure: boolean) =>
    `${ix},${iz},${heading},${departure}`;
  const valid = (ix: number, iz: number) =>
    ix >= 0 && ix < width && iz >= 0 && iz < height;
  CITY_LAYOUT.zStreets.forEach((z, iz) => {
    CITY_LAYOUT.xStreets.forEach((x, ix) => {
      directions.forEach((direction, heading) => {
        for (const departure of [false, true]) {
          const sign = departure ? 1 : -1;
          if (!valid(ix + direction.x * sign, iz + direction.z * sign))
            continue;
          ids.set(key(ix, iz, heading, departure), nodes.length);
          nodes.push({
            id: nodes.length,
            x: x + direction.px + direction.x * 10 * sign,
            z: z + direction.pz + direction.z * 10 * sign,
            next: [],
          });
        }
      });
    });
  });
  CITY_LAYOUT.zStreets.forEach((_z, iz) => {
    CITY_LAYOUT.xStreets.forEach((_x, ix) => {
      directions.forEach((direction, heading) => {
        const departureId = ids.get(key(ix, iz, heading, true));
        if (departureId !== undefined) {
          const approachId = ids.get(
            key(ix + direction.x, iz + direction.z, heading, false),
          );
          if (approachId !== undefined)
            nodes[departureId].next.push(approachId);
        }
        const approachId = ids.get(key(ix, iz, heading, false));
        if (approachId !== undefined) {
          for (const turn of [0, 1, 3]) {
            const outHeading = (heading + turn) % 4;
            const outId = ids.get(key(ix, iz, outHeading, true));
            if (outId !== undefined) nodes[approachId].next.push(outId);
          }
        }
      });
    });
  });
  return nodes;
}

export const CENTRAL_LOCATIONS: WorldLocation[] = [
  {
    id: "palma-market",
    name: "Mercado Palma · authored district",
    x: -324,
    z: 18,
    type: "market",
  },
  {
    id: "mangrove-estates",
    name: "Mangrove Estates · authored neighborhood",
    x: -408.5,
    z: -63.5,
    type: "district",
  },
  {
    id: "south-wharf",
    name: "South Wharf workshops",
    x: -34,
    z: -279,
    type: "district",
  },
  {
    id: "restricted-compound",
    name: "Coastal Reserve · creative facility",
    x: -449,
    z: 144,
    type: "military",
  },
  { id: "ocean-beach", name: "Ocean Beach", x: 180, z: -30, type: "beach" },
  { id: "ocean-drive", name: "Ocean Drive", x: 144, z: -80, type: "district" },
  { id: "nacre-hotel", name: "Nacre Hotel", x: 110, z: -58, type: "landmark" },
  { id: "garage", name: "Sunset Customs", x: -34, z: -55, type: "garage" },
  { id: "gun-shop", name: "Palmetto Supply", x: -105, z: -58, type: "shop" },
  { id: "race", name: "Ocean Circuit", x: 3.3, z: -190, type: "race" },
  {
    id: "little-cuba",
    name: "Little Cuba · authored block",
    x: -180,
    z: 30,
    type: "district",
  },
  { id: "marina", name: "Bayside Marina", x: 208, z: -215, type: "marina" },
  {
    id: "beach-club",
    name: "Solstice Beach Club",
    x: 172,
    z: 118,
    type: "landmark",
  },
  {
    id: "police",
    name: "Ocean Beach Police",
    x: -180,
    z: -110,
    type: "police",
  },
];

/** Creative local training annex; does not replace the planned regional military base. */
export const RESTRICTED_COMPOUND = {
  id: "coastal-reserve-annex",
  minX: -548,
  maxX: -456,
  minZ: 78,
  maxZ: 198,
  entrance: { x: -452, z: 144 },
  warningRadius: 16,
  classification: "creative-mode addition",
} as const;

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
