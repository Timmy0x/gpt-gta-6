import {
  Color3,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PhysicsAggregate,
  PhysicsShapeType,
  StandardMaterial,
  Texture,
  Vector3,
} from "@babylonjs/core";
import type { Material, Scene } from "@babylonjs/core";
import type {
  BuildContext,
  Obstacle,
  RoadNode,
  WorldContract,
  WorldLocation,
} from "../core/contracts";
import {
  CENTRAL_LOCATIONS,
  CITY_LAYOUT,
  createLaneGraph,
  seededRandom,
} from "./layout";

type Detail = "structure" | "detail";
type Batch = {
  meshes: Mesh[];
  material: Material;
  x: number;
  z: number;
  detail: Detail;
  casts: boolean;
};
type Chunk = {
  meshes: Mesh[];
  x: number;
  z: number;
  detail: Detail;
  active: boolean;
};
type BuildingStyle = "deco" | "residential" | "commercial" | "civic";

/**
 * Authored Ocean Beach reconstruction. Architectural vocabulary follows the documented
 * pastel Art Deco district; footprints, names, dimensions and road topology are original.
 * Structural collision is always resident; expensive decorative chunks use distance LOD.
 */
export class World implements WorldContract {
  readonly spawn = new Vector3(3.3, 1.2, -28);
  readonly obstacles: Obstacle[] = [];
  readonly roads: RoadNode[] = createLaneGraph();
  readonly locations: WorldLocation[] = CENTRAL_LOCATIONS.map((location) => ({
    ...location,
  }));
  readonly waterLevel = -0.18;
  private readonly scene: Scene;
  private readonly rng = seededRandom(860409);
  private readonly materials = new Map<string, PBRMaterial>();
  private readonly allMaterials: Material[] = [];
  private readonly textures: Texture[] = [];
  private readonly batches = new Map<string, Batch>();
  private readonly chunks: Chunk[] = [];
  private readonly aggregates: PhysicsAggregate[] = [];
  private readonly collisionMeshes: Mesh[] = [];
  private readonly looseMeshes: Mesh[] = [];
  private readonly litMaterials: {
    material: PBRMaterial;
    color: Color3;
    intensity: number;
  }[] = [];
  private readonly foamMeshes: Mesh[] = [];
  private readonly boxTemplate: Mesh;
  private readonly waterMaterial: PBRMaterial;
  private readonly asphalt: PBRMaterial;
  private readonly window: PBRMaterial;
  private readonly waterBump: DynamicTexture;
  private age = 0;
  private lodClock = 0;
  private lastNight = -1;
  private readonly ctx: BuildContext;

  constructor(ctx: BuildContext) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.boxTemplate = MeshBuilder.CreateBox(
      "world/box-template",
      { size: 1 },
      this.scene,
    );
    this.boxTemplate.setEnabled(false);
    this.asphalt = this.mat("asphalt", "#343b41", 0.95);
    const roadTexture = this.grainTexture(
      "asphalt-grain",
      "#747a80",
      0.16,
      128,
    );
    this.asphalt.albedoTexture = roadTexture;
    roadTexture.uScale = 38;
    roadTexture.vScale = 38;
    this.window = this.mat("glass-blue", "#284f5a", 0.18, 0.42);
    this.window.reflectivityColor = new Color3(0.54, 0.65, 0.7);
    this.waterMaterial = this.mat("ocean-water", "#247f90", 0.16, 0.34);
    this.waterMaterial.alpha = 0.94;
    this.waterBump = this.normalTexture();
    this.waterMaterial.bumpTexture = this.waterBump;
    this.waterBump.level = 0.32;
    this.waterBump.uScale = 80;
    this.waterBump.vScale = 80;
    this.buildTerrain();
    this.buildRoads();
    this.buildBlocks();
    this.buildBeach();
    this.buildMarina();
    this.buildDistantCity();
    this.flushBatches();
    this.update(0, this.spawn, 16, "clear");
  }

  private mat(
    name: string,
    hex: string,
    roughness = 0.72,
    metallic = 0,
  ): PBRMaterial {
    const cached = this.materials.get(name);
    if (cached) return cached;
    const material = new PBRMaterial(`world/${name}`, this.scene);
    material.albedoColor = Color3.FromHexString(hex);
    material.roughness = roughness;
    material.metallic = metallic;
    material.environmentIntensity = 0.7;
    this.materials.set(name, material);
    this.allMaterials.push(material);
    return material;
  }

  private lightMat(name: string, hex: string, intensity = 1): PBRMaterial {
    const material = this.mat(name, hex, 0.38);
    if (!this.litMaterials.some((item) => item.material === material)) {
      this.litMaterials.push({
        material,
        color: Color3.FromHexString(hex),
        intensity,
      });
    }
    return material;
  }

  private grainTexture(
    name: string,
    base: string,
    noise: number,
    size = 128,
  ): DynamicTexture {
    const texture = new DynamicTexture(
      `world/${name}`,
      { width: size, height: size },
      this.scene,
      true,
    );
    const context = texture.getContext();
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);
    for (let i = 0; i < size * size * 0.45; i++) {
      context.fillStyle = `rgba(${this.rng() > 0.5 ? "255,255,255" : "0,0,0"},${this.rng() * noise})`;
      context.fillRect(this.rng() * size, this.rng() * size, 1, 1);
    }
    texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.update();
    this.textures.push(texture);
    return texture;
  }

  private normalTexture(): DynamicTexture {
    const texture = new DynamicTexture(
      "world/water-normal",
      { width: 256, height: 256 },
      this.scene,
      true,
    );
    const context = texture.getContext() as CanvasRenderingContext2D;
    const data = context.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4;
        const u = (x / 256) * Math.PI * 2;
        const v = (y / 256) * Math.PI * 2;
        data.data[i] =
          128 +
          Math.sin(u * 4 + Math.sin(v * 3)) * 27 +
          Math.sin(u * 9 + v * 8) * 13;
        data.data[i + 1] = 128 + Math.cos(v * 5 + Math.sin(u * 3)) * 24;
        data.data[i + 2] = 245;
        data.data[i + 3] = 255;
      }
    }
    context.putImageData(data, 0, 0);
    texture.update();
    texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
    this.textures.push(texture);
    return texture;
  }

  private queue(
    mesh: Mesh,
    material: Material,
    detail: Detail = "detail",
    casts = false,
  ): Mesh {
    const cx = Math.floor((mesh.position.x + 72) / 144) * 144;
    const cz = Math.floor((mesh.position.z + 72) / 144) * 144;
    const key = `${cx}:${cz}:${material.uniqueId}:${detail}:${casts}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { meshes: [], material, x: cx, z: cz, detail, casts };
      this.batches.set(key, batch);
    }
    mesh.material = material;
    mesh.isPickable = false;
    batch.meshes.push(mesh);
    return mesh;
  }

  private box(
    name: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: Material,
    detail: Detail = "detail",
    casts = false,
    rotation = 0,
  ): Mesh {
    const mesh = this.boxTemplate.clone(name, null, true)!;
    mesh.setEnabled(true);
    mesh.scaling.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    return this.queue(mesh, material, detail, casts);
  }

  private cylinder(
    name: string,
    x: number,
    y: number,
    z: number,
    diameter: number,
    height: number,
    material: Material,
    top = diameter,
    tessellation = 8,
    detail: Detail = "detail",
  ): Mesh {
    const mesh = MeshBuilder.CreateCylinder(
      name,
      { height, diameterTop: top, diameterBottom: diameter, tessellation },
      this.scene,
    );
    mesh.position.set(x, y, z);
    return this.queue(mesh, material, detail);
  }

  private beam(
    name: string,
    a: Vector3,
    b: Vector3,
    width: number,
    material: Material,
    detail: Detail = "detail",
  ): void {
    const vector = b.subtract(a);
    const length = vector.length();
    const mesh = MeshBuilder.CreateCylinder(
      name,
      { height: length, diameter: width, tessellation: 5 },
      this.scene,
    );
    mesh.position.copyFrom(a.add(b).scale(0.5));
    const up = vector.scale(1 / length);
    const right = Vector3.Cross(
      Math.abs(up.y) > 0.9 ? Vector3.Right() : Vector3.Up(),
      up,
    ).normalize();
    const forward = Vector3.Cross(right, up).normalize();
    mesh.rotation = Vector3.RotationFromAxis(right, up, forward);
    this.queue(mesh, material, detail);
  }

  private collider(
    name: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    obstacle = true,
  ): void {
    const mesh = MeshBuilder.CreateBox(
      `collision/${name}`,
      { width: w, height: h, depth: d },
      this.scene,
    );
    mesh.position.set(x, y, z);
    mesh.isVisible = false;
    mesh.isPickable = true;
    mesh.metadata = {
      kind: "structure",
      response: "structural",
      material: "concrete",
      cameraBlocker: true,
    };
    this.aggregates.push(
      new PhysicsAggregate(
        mesh,
        PhysicsShapeType.BOX,
        { mass: 0, friction: 0.8, restitution: 0.06 },
        this.scene,
      ),
    );
    this.collisionMeshes.push(mesh);
    if (obstacle) this.obstacles.push({ x, z, w, d, height: h, mesh });
  }

  private buildTerrain(): void {
    const concrete = this.mat("concrete", "#b9b6a8", 0.88);
    const sand = this.mat("sand", "#eee2bc", 0.98);
    const sandTexture = this.grainTexture("sand-grain", "#eee6cf", 0.1);
    sand.albedoTexture = sandTexture;
    sandTexture.uScale = 42;
    sandTexture.vScale = 90;
    this.box(
      "urban-ground",
      -62.5,
      -0.5,
      0,
      435,
      1,
      620,
      concrete,
      "structure",
    );
    this.collider("urban-ground", -62.5, -0.55, 0, 435, 1.1, 620, false);
    this.box("beach-sand", 182.5, -0.52, 0, 55, 1, 1250, sand, "structure");
    this.collider("beach", 182.5, -0.58, 0, 55, 1.1, 1250, false);
    const seabed = this.mat("seabed", "#66a6a1", 1);
    this.box("seabed", 1210, -4.1, 0, 2000, 1, 2400, seabed, "structure");
    this.collider("seabed", 1210, -4.1, 0, 2000, 1, 2400, false);
    const ocean = MeshBuilder.CreateGround(
      "Atlantic Ocean",
      { width: 4200, height: 5200, subdivisions: 1 },
      this.scene,
    );
    ocean.position.set(2310, this.waterLevel, 0);
    ocean.material = this.waterMaterial;
    ocean.isPickable = false;
    this.looseMeshes.push(ocean);
    // The shallow shelf makes watercraft visibly meet the sandy coast.
    const shallow = this.mat("shallows", "#57c2bd", 0.2, 0.15);
    shallow.alpha = 0.58;
    const shelf = MeshBuilder.CreateGround(
      "shallow-turquoise-shelf",
      { width: 48, height: 1600 },
      this.scene,
    );
    shelf.position.set(233, this.waterLevel + 0.009, 0);
    shelf.material = shallow;
    shelf.isPickable = false;
    this.looseMeshes.push(shelf);
    // Garden ground beyond the locally detailed blocks, explicitly provisional.
    const grass = this.mat("grass", "#798762", 0.94);
    this.box(
      "western-green-margin",
      -335,
      -0.6,
      0,
      110,
      1,
      800,
      grass,
      "structure",
    );
    this.collider("western-green-margin", -335, -0.6, 0, 110, 1, 800, false);
  }

  private buildRoads(): void {
    const white = this.mat("road-white", "#dfdfcf", 0.92);
    const yellow = this.mat("road-yellow", "#ecc764", 0.91);
    const curb = this.mat("curb", "#dbd5c6", 0.91);
    const pavement = this.mat("pavement", "#cec4ae", 0.94);
    const expansion = this.mat("paving-seams", "#9a968b", 0.97);
    const { xStreets, zStreets } = CITY_LAYOUT;
    for (const x of xStreets) {
      this.box(
        "north-south-street",
        x,
        0.006,
        0,
        14,
        0.018,
        476,
        this.asphalt,
        "structure",
      );
      for (let z = -235; z < 239; z += 8) {
        if (zStreets.some((cross) => Math.abs(cross - z) < 12)) continue;
        this.box("centre-line", x - 0.18, 0.025, z, 0.09, 0.01, 4.3, yellow);
        this.box("centre-line", x + 0.18, 0.025, z, 0.09, 0.01, 4.3, yellow);
      }
    }
    for (const z of zStreets) {
      this.box(
        "east-west-street",
        -36,
        0.008,
        z,
        374,
        0.018,
        14,
        this.asphalt,
        "structure",
      );
      for (let x = -220; x < 146; x += 8) {
        if (xStreets.some((cross) => Math.abs(cross - x) < 12)) continue;
        this.box("centre-line", x, 0.028, z - 0.18, 4.3, 0.012, 0.09, yellow);
        this.box("centre-line", x, 0.028, z + 0.18, 4.3, 0.012, 0.09, yellow);
      }
    }
    for (const x of xStreets) {
      for (const z of zStreets) {
        for (const side of [-1, 1]) {
          for (let i = -5; i <= 5; i += 2) {
            this.box(
              "crosswalk",
              x + i,
              0.038,
              z + side * 9.1,
              1.06,
              0.018,
              2.45,
              white,
            );
            if (x !== 144 || side === -1)
              this.box(
                "crosswalk",
                x + side * 9.1,
                0.039,
                z + i,
                2.45,
                0.018,
                1.06,
                white,
              );
          }
          this.box(
            "stop-line",
            x + side * 3.5,
            0.04,
            z - side * 11.2,
            5.4,
            0.018,
            0.22,
            white,
          );
          this.box(
            "stop-line",
            x - side * 11.2,
            0.041,
            z - side * 3.5,
            0.22,
            0.018,
            5.4,
            white,
          );
        }
        if ((x / 72 + z / 72) % 2 === 0)
          this.trafficSignal(x - 8.7, z - 8.7, 0);
        else this.stopSign(x + 8.7, z + 8.7);
      }
    }
    for (let ix = 0; ix < xStreets.length - 1; ix++) {
      for (let iz = 0; iz < zStreets.length - 1; iz++) {
        const x = (xStreets[ix] + xStreets[ix + 1]) / 2;
        const z = (zStreets[iz] + zStreets[iz + 1]) / 2;
        this.box(
          "city-block-sidewalk",
          x,
          0.08,
          z,
          58,
          0.16,
          58,
          pavement,
          "structure",
        );
        this.collider("city-block-sidewalk", x, 0.015, z, 58, 0.07, 58, false);
        for (const side of [-1, 1]) {
          this.box("curb-edge", x + side * 28.85, 0.12, z, 0.3, 0.24, 58, curb);
          this.box("curb-edge", x, 0.12, z + side * 28.85, 58, 0.24, 0.3, curb);
          for (let offset = -24; offset < 28; offset += 5) {
            this.box(
              "paving-expansion",
              x + side * 27,
              0.164,
              z + offset,
              3.3,
              0.009,
              0.026,
              expansion,
            );
            this.box(
              "paving-expansion",
              x + offset,
              0.164,
              z + side * 27,
              0.026,
              0.009,
              3.3,
              expansion,
            );
          }
        }
        this.streetLamp(x - 27, z - 18);
        this.streetLamp(x + 27, z + 18);
        this.streetFurniture(x - 25.7, z + 8.5, false);
        this.streetFurniture(x + 26, z - 9, true);
        if (ix > 1 || this.rng() > 0.3) {
          this.palm(x + 25.6, z + 13.5, 7.2 + this.rng() * 2);
          this.palm(x - 25.6, z - 13.5, 7 + this.rng() * 2);
        }
      }
    }
    // Beach promenade and regularly spaced parking bays beside Ocean Drive.
    this.box(
      "ocean-promenade",
      153,
      0.065,
      0,
      4,
      0.13,
      510,
      pavement,
      "structure",
    );
    for (let z = -235; z < 240; z += 8) {
      if (!zStreets.some((cross) => Math.abs(cross - z) < 14)) {
        this.box("parking-bay", 148.6, 0.042, z, 3.8, 0.015, 0.1, white);
      }
    }
    for (let z = -238; z <= 238; z += 24) {
      this.palm(157.5, z, 9 + this.rng() * 2.1);
      this.streetLamp(151.5, z + 8, true);
      this.streetFurniture(154, z + 11, true);
    }
  }

  private buildBlocks(): void {
    const xs = [-180, -108, -36, 36, 108];
    const zs = [-180, -108, -36, 36, 108, 180];
    for (const x of xs) {
      for (const z of zs) {
        if (x === -36 && z === -36) {
          this.garage(x, z);
          continue;
        }
        if (x === -108 && z === -36) {
          this.shop(x, z);
          continue;
        }
        if (x === -180 && z === -108) {
          this.policeStation(x, z);
          continue;
        }
        if (x === 36 && z === 36) {
          this.park(x, z);
          continue;
        }
        if (x === 108) {
          const names = [
            "THE PALM",
            "CORAL REEF",
            "NACRE",
            "SOLÉIL",
            "THE TIDELINE",
            "AVALON",
          ];
          this.building(
            x + 1,
            z,
            35,
            39,
            z === -36 ? 25 : 14 + this.rng() * 14,
            "deco",
            names[zs.indexOf(z)],
          );
          this.pool(x - 22, z + 4, 7, 19);
          for (const dz of [-19, 19]) this.palm(x + 22, z + dz, 8.2);
        } else if (x === -180) {
          this.building(
            x - 11.2,
            z - 10,
            19,
            29,
            7.5 + this.rng() * 4,
            "commercial",
            ["PANADERÍA", "BOTÁNICA", "CAFÉ CUBANO", "LA ESTRELLA"][
              Math.floor(this.rng() * 4)
            ],
          );
          this.building(
            x + 11.4,
            z + 6,
            20,
            32,
            9.5 + this.rng() * 8,
            "residential",
            "",
          );
          this.backyard(x - 11, z + 18, 18, 10);
        } else if (this.rng() > 0.54) {
          this.building(
            x - 11.9,
            z - 6,
            19.5,
            38,
            10 + this.rng() * 15,
            "residential",
            "",
          );
          this.building(
            x + 12,
            z + 4,
            19.5,
            36,
            8 + this.rng() * 13,
            "deco",
            "",
          );
          this.box(
            "service-alley",
            x,
            0.17,
            z,
            3.8,
            0.02,
            48,
            this.mat("alley", "#696d66"),
          );
          this.dumpster(x, z + 17);
        } else {
          this.building(
            x,
            z - 9,
            42,
            24,
            6.7 + this.rng() * 5,
            "commercial",
            [
              "SUNRISE MARKET",
              "VINYL & SOUL",
              "24 HOUR DELI",
              "PALMETTO",
              "SALT & LIME",
            ][Math.floor(this.rng() * 5)],
          );
          this.building(
            x - 10,
            z + 16,
            20,
            16,
            14 + this.rng() * 12,
            "residential",
            "",
          );
          this.backyard(x + 12, z + 15, 18, 17);
        }
      }
    }
  }

  private building(
    x: number,
    z: number,
    w: number,
    d: number,
    approximateHeight: number,
    style: BuildingStyle,
    name: string,
  ): void {
    const colors = [
      "#e9cfc0",
      "#d6e2d4",
      "#dfdce0",
      "#eddec1",
      "#e1bab4",
      "#c4d7d3",
      "#e7d5c6",
    ];
    const accentColors = [
      "#859f9b",
      "#b98a81",
      "#b8a48a",
      "#8ba0b4",
      "#c09c91",
      "#73a8a2",
    ];
    const colorIndex = Math.floor(this.rng() * colors.length);
    const wall = this.mat(`stucco-${colorIndex}`, colors[colorIndex], 0.89);
    const accentIndex = Math.floor(this.rng() * accentColors.length);
    const accent = this.mat(
      `trim-${accentIndex}`,
      accentColors[accentIndex],
      0.8,
    );
    const cream = this.mat("ivory-trim", "#eee8d8", 0.79);
    const dark = this.mat("metal-dark", "#3d4b4c", 0.6, 0.45);
    const floorHeight = 3.3;
    const floors = Math.max(2, Math.round(approximateHeight / floorHeight));
    const height = floors * floorHeight + 0.6;
    const ground = 0.17;
    this.box(
      "stucco-building",
      x,
      ground + height / 2,
      z,
      w,
      height,
      d,
      wall,
      "structure",
      true,
    );
    this.collider("building", x, ground + height / 2, z, w, height, d);
    this.box(
      "foundation-course",
      x,
      0.55,
      z,
      w + 0.18,
      0.76,
      d + 0.18,
      accent,
      "structure",
    );
    this.box(
      "roof-cornice",
      x,
      height + 0.1,
      z,
      w + 0.7,
      0.42,
      d + 0.7,
      cream,
      "structure",
    );
    this.box(
      "roof-top",
      x,
      height + 0.39,
      z,
      w - 0.5,
      0.16,
      d - 0.5,
      this.mat("roof", "#a0a69e"),
      "structure",
    );
    for (const side of [-1, 1]) {
      this.box(
        "parapet",
        x + side * (w / 2 - 0.13),
        height + 0.85,
        z,
        0.22,
        1,
        d,
        wall,
        "structure",
      );
      this.box(
        "parapet",
        x,
        height + 0.85,
        z + side * (d / 2 - 0.13),
        w,
        1,
        0.22,
        wall,
        "structure",
      );
    }
    this.box(
      "roof-access",
      x + w * 0.23,
      height + 1.35,
      z + d * 0.2,
      3.3,
      2.5,
      4.1,
      wall,
      "detail",
      true,
    );
    this.box(
      "air-conditioner",
      x - w * 0.19,
      height + 0.85,
      z + d * 0.14,
      2.9,
      1.1,
      1.7,
      this.mat("ac", "#b8bfbc"),
    );
    for (let vent = 0; vent < 5; vent++)
      this.box(
        "ac-vent",
        x - w * 0.19 - 1.15 + vent * 0.5,
        height + 1.42,
        z + d * 0.14,
        0.08,
        0.025,
        1.3,
        dark,
      );

    // Four proper facades, with lintels, sills, recessed blue glazing and slender mullions.
    for (let face = 0; face < 4; face++) {
      const horizontal = face % 2 === 0;
      const side = face < 2 ? -1 : 1;
      const span = horizontal ? w : d;
      const depth = horizontal ? d : w;
      const columns = Math.max(3, Math.floor(span / 4.3));
      const step = span / columns;
      const faceBox = (
        label: string,
        along: number,
        y: number,
        ww: number,
        hh: number,
        dd: number,
        material: Material,
        offset = 0,
      ) => {
        this.box(
          label,
          horizontal ? x + along : x + side * (depth / 2 + offset),
          y,
          horizontal ? z + side * (depth / 2 + offset) : z + along,
          horizontal ? ww : dd,
          hh,
          horizontal ? dd : ww,
          material,
        );
      };
      for (let floor = 1; floor < floors; floor++) {
        const y = ground + floor * floorHeight + 1.45;
        if (style === "deco")
          faceBox(
            "deco-belt-course",
            0,
            floor * floorHeight + 0.48,
            span + 0.35,
            0.18,
            0.45,
            cream,
            0.12,
          );
        for (let col = 0; col < columns; col++) {
          const along = -span / 2 + step * (col + 0.5);
          const ww = style === "residential" ? 1.65 : Math.min(2.35, step - 1);
          faceBox(
            "window-surround",
            along,
            y,
            ww + 0.22,
            2.03,
            0.16,
            cream,
            0.05,
          );
          const glass =
            (floor + col + Math.floor(x)) % 7 === 0
              ? this.lightMat("warm-windows", "#e9c38b", 0.55)
              : this.window;
          faceBox("window-glass", along, y, ww, 1.79, 0.07, glass, 0.145);
          faceBox("window-mullion", along, y, 0.07, 1.87, 0.12, cream, 0.2);
          faceBox(
            "window-sill",
            along,
            y - 0.97,
            ww + 0.36,
            0.12,
            0.36,
            cream,
            0.14,
          );
          if (style === "residential" && col % 2 === 0) {
            faceBox(
              "balcony-slab",
              along,
              y - 1.17,
              ww + 1.1,
              0.17,
              1.18,
              cream,
              0.65,
            );
            faceBox(
              "balcony-handrail",
              along,
              y - 0.27,
              ww + 0.99,
              0.075,
              0.08,
              dark,
              1.19,
            );
            for (const rail of [-0.8, -0.4, 0, 0.4, 0.8])
              faceBox(
                "balcony-baluster",
                along + rail,
                y - 0.66,
                0.045,
                0.78,
                0.06,
                dark,
                1.19,
              );
          } else if (style === "deco") {
            faceBox(
              "eyebrow-shade",
              along,
              y + 1.11,
              ww + 0.68,
              0.14,
              0.64,
              cream,
              0.25,
            );
          }
        }
      }
      // Ground level storefront transoms / lobby doors and side service entrances.
      const storefront =
        horizontal && (style === "commercial" || style === "deco");
      for (let col = 0; col < columns; col++) {
        const along = -span / 2 + step * (col + 0.5);
        faceBox(
          "ground-door-frame",
          along,
          1.67,
          Math.min(step - 0.7, 3.15),
          2.93,
          0.12,
          cream,
          0.05,
        );
        faceBox(
          "ground-glass",
          along,
          1.68,
          Math.min(step - 0.95, 2.9),
          2.67,
          0.1,
          this.window,
          0.13,
        );
        faceBox(
          "door-transom",
          along,
          2.79,
          Math.min(step - 0.91, 2.94),
          0.065,
          0.16,
          dark,
          0.19,
        );
        faceBox(
          "door-handle",
          along + 0.35,
          1.23,
          0.05,
          0.38,
          0.08,
          cream,
          0.23,
        );
        if (storefront && col !== Math.floor(columns / 2)) {
          faceBox(
            "shop-awning",
            along,
            3.18,
            step - 0.3,
            0.2,
            1.9,
            accent,
            0.92,
          );
          faceBox(
            "awning-valance",
            along,
            2.98,
            step - 0.3,
            0.32,
            0.09,
            accent,
            1.82,
          );
          for (let stripe = -1; stripe <= 1; stripe++)
            faceBox(
              "awning-stripe",
              along + stripe * 0.72,
              3.287,
              0.3,
              0.016,
              1.77,
              cream,
              0.92,
            );
        }
      }
      if (style === "deco") {
        for (const end of [-1, 1])
          faceBox(
            "art-deco-pilaster",
            end * (span / 2 - 0.5),
            height / 2,
            0.7,
            height - 0.1,
            0.42,
            cream,
            0.1,
          );
      }
    }

    if (style === "deco") {
      // The center crown has a recognisable stepped Art Deco silhouette.
      this.box(
        "deco-centre-tower",
        x,
        height * 0.53 + 0.3,
        z - d / 2 - 0.42,
        5.1,
        height + 1.3,
        0.95,
        accent,
        "structure",
        true,
      );
      this.box(
        "deco-crown-one",
        x,
        height + 1.65,
        z - d / 2 - 0.42,
        4.2,
        1.5,
        1.02,
        cream,
        "structure",
      );
      this.box(
        "deco-crown-two",
        x,
        height + 2.7,
        z - d / 2 - 0.42,
        2.65,
        1.1,
        1.02,
        accent,
        "structure",
      );
      const neon = this.lightMat("neon-mint", "#68e0ce", 1.7);
      for (const nx of [-1, 0, 1])
        this.box(
          "deco-neon-stripe",
          x + nx * 0.64,
          height * 0.68,
          z - d / 2 - 0.92,
          0.065,
          height * 0.62,
          0.035,
          neon,
        );
      this.box(
        "entrance-canopy",
        x,
        3.87,
        z - d / 2 - 2.3,
        8.4,
        0.39,
        4.6,
        cream,
        "detail",
        true,
      );
      this.box(
        "canopy-edge-neon",
        x,
        3.81,
        z - d / 2 - 4.64,
        8.35,
        0.1,
        0.06,
        this.lightMat("neon-rose", "#f5a2b7", 1.35),
      );
      for (const side of [-1, 1])
        this.cylinder(
          "canopy-column",
          x + side * 3.58,
          1.96,
          z - d / 2 - 3.82,
          0.23,
          3.6,
          cream,
          0.23,
          8,
        );
    }
    if (name) {
      const signY = style === "deco" ? height - 0.7 : 3.65;
      this.sign(
        name,
        x,
        signY,
        z - d / 2 - (style === "deco" ? 1 : 0.17),
        Math.min(w - 2, name.length * 0.79),
        style === "deco" ? 1.72 : 0.95,
        "#e5f4e6",
        "#475e5d",
      );
      if (style === "deco")
        this.sign(
          "HOTEL  •  OCEAN BEACH",
          x,
          3.91,
          z - d / 2 - 4.64,
          7.25,
          0.42,
          "#f6e4d1",
          "#6e8e8a",
        );
    }
    this.planter(x - w * 0.4, z - d / 2 - 1.1, 1.8, 0.9);
    this.planter(x + w * 0.4, z - d / 2 - 1.1, 1.8, 0.9);
  }

  private sign(
    text: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    color: string,
    background: string,
    rotation = 0,
  ): void {
    const texture = new DynamicTexture(
      `sign/${text}`,
      { width: 1024, height: 128 },
      this.scene,
      true,
    );
    const context = texture.getContext() as CanvasRenderingContext2D;
    context.fillStyle = background;
    context.fillRect(0, 0, 1024, 128);
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.strokeRect(12, 11, 1000, 106);
    context.fillStyle = color;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${text.length > 23 ? 47 : 67}px sans-serif`;
    context.fillText(text, 512, 69, 955);
    texture.update();
    const material = new PBRMaterial(`sign-material/${text}`, this.scene);
    material.albedoTexture = texture;
    material.emissiveTexture = texture;
    material.emissiveColor = new Color3(0.25, 0.25, 0.25);
    material.roughness = 0.7;
    material.metallic = 0;
    this.allMaterials.push(material);
    this.textures.push(texture);
    const mesh = MeshBuilder.CreatePlane(
      `sign/${text}`,
      { width: w, height: h, sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    this.looseMeshes.push(mesh);
  }

  private garage(x: number, z: number): void {
    const stucco = this.mat("garage-stucco", "#c5cfbb");
    const turquoise = this.mat("garage-teal", "#448982");
    const floor = this.mat("garage-floor", "#8f9690");
    // A drive-in service interior: three structural walls, four pillars and an open front.
    this.box(
      "garage-back-wall",
      x,
      3.15,
      z + 14,
      39,
      6,
      0.6,
      stucco,
      "structure",
      true,
    );
    this.collider("garage-back", x, 3.15, z + 14, 39, 6, 0.6);
    for (const side of [-1, 1]) {
      this.box(
        "garage-side-wall",
        x + side * 19.5,
        3.15,
        z,
        0.65,
        6,
        28,
        stucco,
        "structure",
        true,
      );
      this.collider("garage-side", x + side * 19.5, 3.15, z, 0.65, 6, 28);
    }
    this.box(
      "garage-flat-roof",
      x,
      6.22,
      z,
      40.3,
      0.38,
      29,
      turquoise,
      "structure",
      true,
    );
    this.collider("garage-roof", x, 6.22, z, 40.3, 0.38, 29, false);
    this.box(
      "garage-concrete-floor",
      x,
      0.19,
      z,
      39,
      0.1,
      28,
      floor,
      "structure",
    );
    this.box(
      "garage-fascia",
      x,
      5.28,
      z - 14,
      40,
      1.56,
      0.5,
      stucco,
      "structure",
    );
    for (const px of [-19.3, -6.4, 6.4, 19.3]) {
      this.box(
        "garage-front-pillar",
        x + px,
        2.45,
        z - 13.8,
        0.55,
        4.6,
        0.65,
        turquoise,
        "structure",
        true,
      );
      this.collider("garage-pillar", x + px, 2.45, z - 13.8, 0.55, 4.6, 0.65);
    }
    this.sign(
      "SUNSET CUSTOMS",
      x,
      5.41,
      z - 14.32,
      22,
      1.17,
      "#ffe3ad",
      "#296d68",
    );
    this.sign(
      "REPAIR  /  RESPRAY  /  PERFORMANCE",
      x,
      4.46,
      z - 14.33,
      22,
      0.49,
      "#f6e9cd",
      "#296d68",
    );
    const yellow = this.mat("road-yellow", "#ecc764");
    for (const bay of [-12.8, 0, 12.8]) {
      for (const side of [-1, 1]) {
        this.box(
          "workshop-lift-track",
          x + bay + side * 1.03,
          0.31,
          z + 2,
          0.55,
          0.18,
          6.1,
          turquoise,
        );
        this.box(
          "bay-marking",
          x + bay + side * 4.1,
          0.249,
          z - 2,
          0.09,
          0.01,
          20,
          yellow,
        );
      }
      this.box(
        "workbench",
        x + bay,
        0.85,
        z + 11.5,
        5.5,
        1.3,
        1.1,
        this.mat("tool-red", "#934b43"),
      );
      this.box("workbench-top", x + bay, 1.54, z + 11.5, 5.7, 0.1, 1.3, floor);
      this.box(
        "workshop-ceiling-light",
        x + bay,
        5.99,
        z + 1,
        4.7,
        0.06,
        0.32,
        this.lightMat("workshop-light", "#f4efd8", 1.4),
      );
      for (let tyre = 0; tyre < 3; tyre++) {
        this.cylinder(
          "stacked-tyre",
          x + bay + 3.8,
          0.39 + tyre * 0.29,
          z + 9.6,
          0.79,
          0.28,
          this.mat("rubber", "#272e30"),
          0.79,
          12,
        );
      }
    }
    this.dumpster(x + 21.5, z + 8);
    this.palm(x - 23.5, z - 18, 8.4);
    this.palm(x + 23.5, z - 18, 8.4);
    this.sign("DRIVE IN", x, 0.21, z - 22, 6, 1.2, "#ece8d9", "#617d76", 0);
  }

  private shop(x: number, z: number): void {
    // Enterable shop with a wide doorway and visible shelves.
    const wall = this.mat("shop-plaster", "#d4b996");
    const trim = this.mat("shop-trim", "#596d67");
    const w = 35,
      d = 27;
    this.box(
      "shop-back",
      x,
      2.72,
      z + d / 2,
      w,
      5.1,
      0.45,
      wall,
      "structure",
      true,
    );
    this.collider("shop-back", x, 2.72, z + d / 2, w, 5.1, 0.45);
    for (const side of [-1, 1]) {
      this.box(
        "shop-side",
        x + (side * w) / 2,
        2.72,
        z,
        0.45,
        5.1,
        d,
        wall,
        "structure",
        true,
      );
      this.collider("shop-side", x + (side * w) / 2, 2.72, z, 0.45, 5.1, d);
      this.box(
        "shop-front-wing",
        x + side * 11,
        2,
        z - d / 2,
        13,
        3.65,
        0.38,
        trim,
        "structure",
      );
      this.collider(
        "shop-front-wing",
        x + side * 11,
        2,
        z - d / 2,
        13,
        3.65,
        0.38,
      );
      this.box(
        "shop-window",
        x + side * 11,
        2.02,
        z - d / 2 - 0.21,
        10.6,
        2.7,
        0.05,
        this.window,
      );
    }
    this.box(
      "shop-roof",
      x,
      5.24,
      z,
      w + 0.7,
      0.36,
      d + 0.7,
      trim,
      "structure",
      true,
    );
    this.collider("shop-roof", x, 5.24, z, w + 0.7, 0.36, d + 0.7, false);
    this.box(
      "shop-fascia",
      x,
      4.43,
      z - d / 2,
      w + 0.3,
      1.4,
      0.5,
      wall,
      "structure",
    );
    this.sign(
      "PALMETTO SUPPLY",
      x,
      4.49,
      z - d / 2 - 0.27,
      26,
      1.1,
      "#f2e3b9",
      "#536a59",
    );
    this.sign(
      "OUTDOORS  ·  SPORTING GOODS",
      x,
      3.67,
      z - d / 2 - 0.3,
      24,
      0.43,
      "#e8d7af",
      "#536a59",
    );
    this.box(
      "shop-floor",
      x,
      0.205,
      z,
      w,
      0.07,
      d,
      this.mat("tile-floor", "#c1c4b6"),
      "structure",
    );
    for (let row = 0; row < 3; row++) {
      for (let shelf = 0; shelf < 4; shelf++) {
        this.box(
          "shop-shelf",
          x - 10 + row * 10,
          0.7 + shelf * 0.5,
          z + 6,
          5.5,
          0.07,
          1.1,
          trim,
        );
        for (let stock = 0; stock < 5; stock++)
          this.box(
            "shop-stock",
            x - 12 + row * 10 + stock,
            0.95 + shelf * 0.5,
            z + 6,
            0.65,
            0.43,
            0.7,
            this.mat(
              `stock-${stock}`,
              ["#a78c6a", "#767e64", "#c9b48b", "#9bafad", "#a77564"][stock],
            ),
          );
      }
    }
    this.box("shop-counter", x + 9, 0.84, z - 5, 9, 1.26, 1.4, trim);
    this.collider("shop-counter", x + 9, 0.84, z - 5, 9, 1.26, 1.4);
    this.box(
      "shop-till",
      x + 9,
      1.57,
      z - 5,
      0.55,
      0.28,
      0.52,
      this.mat("metal-dark", "#3d4b4c"),
    );
    this.backyard(x, z + 20.5, 32, 9);
    this.palm(x - 22, z - 18, 7.4);
  }

  private policeStation(x: number, z: number): void {
    this.building(x, z + 5, 40, 28, 9.2, "civic", "OCEAN BEACH POLICE");
    const blue = this.mat("civic-blue", "#2b5364");
    this.box("station-canopy", x, 3.65, z - 12, 18, 0.26, 6, blue, "structure");
    this.sign(
      "VICE CITY  •  PUBLIC SAFETY",
      x,
      3.83,
      z - 15.1,
      16,
      0.65,
      "#e2e8d6",
      "#264b5b",
    );
    for (let i = 0; i < 5; i++)
      this.box(
        "station-parking",
        x - 17 + i * 8,
        0.18,
        z - 21,
        0.08,
        0.015,
        7,
        this.mat("road-white", "#dfdfcf"),
      );
  }

  private park(x: number, z: number): void {
    const grass = this.mat("grass", "#798762");
    const white = this.mat("ivory-trim", "#eee8d8");
    this.box("pocket-park-lawn", x, 0.19, z, 48, 0.05, 48, grass, "structure");
    this.box(
      "park-east-west-walk",
      x,
      0.231,
      z,
      48,
      0.04,
      4.4,
      this.mat("pavement", "#cec4ae"),
    );
    this.box(
      "park-north-south-walk",
      x,
      0.231,
      z,
      4.4,
      0.04,
      48,
      this.mat("pavement", "#cec4ae"),
    );
    this.cylinder("fountain-plinth", x, 0.43, z, 9, 0.43, white, 9, 32);
    this.cylinder(
      "fountain-water",
      x,
      0.66,
      z,
      8.1,
      0.06,
      this.waterMaterial,
      8.1,
      32,
    );
    this.cylinder("fountain-centre", x, 1.22, z, 1.2, 1.1, white, 0.6, 12);
    this.cylinder("fountain-dish", x, 1.94, z, 3.6, 0.4, white, 3.9, 24);
    for (const dx of [-17, 17])
      for (const dz of [-17, 17]) {
        this.palm(x + dx, z + dz, 8.1);
        this.planter(x + dx, z + dz, 4, 4);
      }
    for (const side of [-1, 1]) {
      this.bench(x + side * 11, z + 5, 0);
      this.bench(x + side * 11, z - 5, Math.PI);
    }
    this.sign("PALM COURT", x, 1.25, z - 23.5, 6, 0.8, "#f4e4c5", "#658679");
  }

  private backyard(x: number, z: number, w: number, d: number): void {
    this.box(
      "yard-grass",
      x,
      0.18,
      z,
      w,
      0.02,
      d,
      this.mat("grass", "#798762"),
    );
    const fence = this.mat("fence", "#b1a88b");
    for (const side of [-1, 1]) {
      this.box(
        "yard-fence-rail",
        x,
        0.9,
        z + (side * d) / 2,
        w,
        0.09,
        0.09,
        fence,
      );
      this.box(
        "yard-fence-rail",
        x,
        0.49,
        z + (side * d) / 2,
        w,
        0.09,
        0.09,
        fence,
      );
      for (let n = -w / 2; n <= w / 2; n += 1.1)
        this.box(
          "yard-fence-picket",
          x + n,
          0.77,
          z + (side * d) / 2,
          0.09,
          1.17,
          0.09,
          fence,
        );
    }
    this.palm(x - w * 0.25, z, 5.8 + this.rng() * 2);
    this.dumpster(x + w * 0.25, z + d * 0.25);
  }

  private pool(x: number, z: number, w: number, d: number): void {
    this.box(
      "pool-coping",
      x,
      0.24,
      z,
      w + 1.6,
      0.13,
      d + 1.6,
      this.mat("ivory-trim", "#eee8d8"),
    );
    this.box(
      "pool-tile",
      x,
      0.315,
      z,
      w,
      0.02,
      d,
      this.mat("pool-tile", "#5aaea8"),
    );
    this.box(
      "pool-water",
      x,
      0.34,
      z,
      w - 0.2,
      0.02,
      d - 0.2,
      this.waterMaterial,
    );
    for (const dz of [-d * 0.34, d * 0.34])
      this.lounger(x, z + dz, Math.PI / 2, false);
  }

  private streetLamp(x: number, z: number, beach = false): void {
    const metal = this.mat("lamp-bronze", "#596461", 0.54, 0.56);
    this.cylinder("lamp-base", x, 0.46, z, 0.38, 0.62, metal, 0.23);
    this.cylinder("lamp-post", x, 3.76, z, 0.15, 6.9, metal, 0.105);
    const toward = beach ? -1 : x < 0 ? -1 : 1;
    this.beam(
      "lamp-arm",
      new Vector3(x, 7.15, z),
      new Vector3(x + toward * 1.5, 7.35, z),
      0.105,
      metal,
    );
    this.box(
      "lamp-housing",
      x + toward * 1.52,
      7.31,
      z,
      0.87,
      0.2,
      0.39,
      metal,
    );
    this.box(
      "lamp-emitter",
      x + toward * 1.52,
      7.19,
      z,
      0.73,
      0.05,
      0.31,
      this.lightMat("street-light", "#ffdfa0", 2.2),
    );
  }

  private trafficSignal(x: number, z: number, rotation: number): void {
    const metal = this.mat("metal-dark", "#3d4b4c");
    this.cylinder("traffic-post", x, 2.77, z, 0.12, 5.2, metal);
    this.box(
      "traffic-signal-box",
      x,
      4.87,
      z - 0.1,
      0.33,
      1.11,
      0.31,
      metal,
      "detail",
      false,
      rotation,
    );
    for (let n = 0; n < 3; n++) {
      const color = ["#d06b54", "#e4bf74", "#7ba994"][n];
      const lamp = this.lightMat(`signal-${n}`, color, n === 2 ? 0.5 : 0.13);
      const disc = MeshBuilder.CreateSphere(
        "traffic-signal-lens",
        { diameter: 0.19, segments: 6 },
        this.scene,
      );
      disc.position.set(x, 5.19 - n * 0.33, z - 0.275);
      disc.scaling.z = 0.23;
      this.queue(disc, lamp);
    }
  }

  private stopSign(x: number, z: number): void {
    const metal = this.mat("metal-dark", "#3d4b4c");
    this.cylinder("stop-post", x, 1.7, z, 0.065, 3.1, metal);
    const mesh = MeshBuilder.CreateCylinder(
      "stop-sign",
      { diameter: 0.71, height: 0.04, tessellation: 8 },
      this.scene,
    );
    mesh.position.set(x, 2.7, z);
    mesh.rotation.x = Math.PI / 2;
    this.queue(mesh, this.mat("stop-red", "#b4574c"));
  }

  private streetFurniture(x: number, z: number, facing: boolean): void {
    if (this.rng() > 0.37)
      this.bench(x, z, facing ? Math.PI / 2 : -Math.PI / 2);
    this.cylinder(
      "trash-bin",
      x,
      0.68,
      z + 2.1,
      0.52,
      1.03,
      this.mat("municipal-teal", "#3e6c65"),
      0.52,
      10,
    );
    this.cylinder(
      "bin-lid",
      x,
      1.22,
      z + 2.1,
      0.57,
      0.075,
      this.mat("metal-dark", "#3d4b4c"),
      0.57,
      10,
    );
    if (this.rng() > 0.5) {
      this.cylinder(
        "fire-hydrant",
        x - 0.2,
        0.55,
        z - 2.8,
        0.23,
        0.7,
        this.mat("hydrant", "#b17958"),
        0.19,
        8,
      );
      this.box(
        "hydrant-crosspiece",
        x - 0.2,
        0.74,
        z - 2.8,
        0.45,
        0.14,
        0.17,
        this.mat("hydrant", "#b17958"),
      );
    }
  }

  private bench(x: number, z: number, angle: number): void {
    const wood = this.mat("wood", "#a28964");
    const metal = this.mat("metal-dark", "#3d4b4c");
    const point = (dx: number, dz: number) => ({
      x: x + dx * Math.cos(angle) + dz * Math.sin(angle),
      z: z - dx * Math.sin(angle) + dz * Math.cos(angle),
    });
    for (let slat = 0; slat < 4; slat++) {
      const p = point(0, -0.22 + slat * 0.14);
      this.box(
        "bench-seat-slat",
        p.x,
        0.64,
        p.z,
        1.88,
        0.065,
        0.1,
        wood,
        "detail",
        false,
        angle,
      );
    }
    for (let slat = 0; slat < 3; slat++) {
      const p = point(0, 0.33);
      this.box(
        "bench-back-slat",
        p.x,
        0.89 + slat * 0.14,
        p.z,
        1.88,
        0.095,
        0.055,
        wood,
        "detail",
        false,
        angle,
      );
    }
    for (const side of [-1, 1]) {
      const p = point(side * 0.69, 0);
      this.box(
        "bench-leg",
        p.x,
        0.4,
        p.z,
        0.07,
        0.45,
        0.55,
        metal,
        "detail",
        false,
        angle,
      );
    }
  }

  private planter(x: number, z: number, w: number, d: number): void {
    this.box(
      "planter",
      x,
      0.48,
      z,
      w,
      0.57,
      d,
      this.mat("planter-stone", "#b6afa0"),
    );
    this.box(
      "planter-soil",
      x,
      0.782,
      z,
      w - 0.2,
      0.035,
      d - 0.2,
      this.mat("soil", "#575d4b"),
    );
    for (let n = 0; n < 3; n++) {
      const shrub = MeshBuilder.CreateSphere(
        "ornamental-shrub",
        { diameter: 0.79, segments: 5 },
        this.scene,
      );
      shrub.position.set(x + ((n - 1) * w) / 4, 0.97, z);
      shrub.scaling.set(w / 2.8, 0.76, d / 1.1);
      this.queue(shrub, this.mat("shrub", "#688360"));
    }
  }

  private dumpster(x: number, z: number): void {
    const green = this.mat("dumpster-green", "#537467");
    this.box("dumpster", x, 0.76, z, 1.8, 1.15, 1.04, green);
    this.box(
      "dumpster-lid",
      x,
      1.38,
      z,
      1.94,
      0.1,
      1.14,
      this.mat("rubber", "#272e30"),
    );
    for (const side of [-1, 1])
      this.box(
        "dumpster-foot",
        x + side * 0.68,
        0.23,
        z,
        0.17,
        0.15,
        0.65,
        this.mat("metal-dark", "#3d4b4c"),
      );
  }

  private palm(x: number, z: number, height: number): void {
    const trunk = this.mat("palm-trunk", "#92836a");
    const foliage = this.mat("palm-fronds", "#507b56", 0.83);
    const young = this.mat("palm-frond-light", "#81955d", 0.87);
    const leanX = (this.rng() - 0.5) * 1.6;
    const leanZ = (this.rng() - 0.5) * 1.6;
    const base = new Vector3(x, 0.16, z);
    const crown = new Vector3(x + leanX, height, z + leanZ);
    this.beam("palm-trunk", base, crown, 0.32, trunk);
    // Rings and swept, tapered fronds give silhouettes without stock cylinder-and-cone trees.
    for (let ring = 1.5; ring < height - 1; ring += 0.95) {
      const t = ring / height;
      this.cylinder(
        "palm-bark-ring",
        x + leanX * t,
        ring,
        z + leanZ * t,
        0.354 - t * 0.03,
        0.07,
        this.mat("bark-ring", "#7c745e"),
        0.35 - t * 0.03,
        7,
      );
    }
    const rotation = this.rng() * Math.PI * 2;
    for (let frond = 0; frond < 9; frond++) {
      const angle = rotation + (frond * Math.PI * 2) / 9;
      const length = 3.4 + this.rng() * 1.1;
      const paths: Vector3[][] = [[], []];
      const direction = new Vector3(Math.cos(angle), 0, Math.sin(angle));
      const cross = new Vector3(-direction.z, 0, direction.x);
      for (let step = 0; step <= 8; step++) {
        const t = step / 8;
        const yy = Math.sin(t * Math.PI) * 0.97 - t * t * 1.2;
        const center = crown
          .add(direction.scale(t * length))
          .add(new Vector3(0, yy, 0));
        const width = Math.sin(Math.PI * t) * (0.4 + 0.04 * (step % 2));
        paths[0].push(center.add(cross.scale(width)));
        paths[1].push(center.subtract(cross.scale(width)));
      }
      const leaf = MeshBuilder.CreateRibbon(
        "palm-frond",
        { pathArray: paths, sideOrientation: Mesh.DOUBLESIDE },
        this.scene,
      );
      // Mesh vertices are authored in world coordinates; chunk at the tree position.
      leaf.position.copyFrom(crown);
      leaf.bakeTransformIntoVertices(
        Matrix.Translation(-crown.x, -crown.y, -crown.z),
      );
      this.queue(leaf, frond % 3 === 0 ? young : foliage);
      const tip = crown
        .add(direction.scale(length * 0.82))
        .add(new Vector3(0, -0.1, 0));
      this.beam("palm-spine", crown, tip, 0.035, young);
    }
    for (let c = 0; c < 3; c++) {
      const coconut = MeshBuilder.CreateSphere(
        "coconut",
        { diameter: 0.23, segments: 5 },
        this.scene,
      );
      coconut.position.set(
        crown.x + Math.cos(c) * 0.22,
        height - 0.3,
        crown.z + Math.sin(c) * 0.22,
      );
      this.queue(coconut, this.mat("coconut", "#796649"));
    }
  }

  private buildBeach(): void {
    const wood = this.mat("boardwalk-wood", "#b2a282");
    const white = this.mat("ivory-trim", "#eee8d8");
    for (const z of [-144, 0, 144]) {
      this.box("beach-access-boardwalk", 176, 0.115, z, 40, 0.12, 2.5, wood);
      for (let x = 157; x < 196; x += 1.1)
        this.box(
          "boardwalk-joint",
          x,
          0.181,
          z,
          0.035,
          0.014,
          2.49,
          this.mat("wood-joint", "#8e826c"),
        );
    }
    for (let z = -165; z <= 198; z += 28) {
      const x = 178 + this.rng() * 11;
      this.umbrella(x, z, this.rng() > 0.5 ? "coral" : "mint");
      this.lounger(x - 1.9, z + 0.7, -Math.PI / 2);
      this.lounger(x + 1.9, z + 0.7, -Math.PI / 2);
    }
    for (const z of [-106, 84, 215]) {
      this.lifeguardTower(194, z);
    }
    // Beach volleyball and a small outdoor club create usable destinations at human scale.
    const net = this.mat("net-rope", "#ede6d0");
    const pole = this.mat("municipal-teal", "#3e6c65");
    for (const side of [-1, 1])
      this.cylinder(
        "volleyball-post",
        175,
        1.5,
        55 + side * 4.6,
        0.09,
        3.0,
        pole,
      );
    for (let line = 0; line < 6; line++)
      this.box(
        "volleyball-net-horizontal",
        175,
        1.8 + line * 0.15,
        55,
        0.02,
        0.012,
        9.2,
        net,
      );
    for (let line = -4.5; line <= 4.5; line += 0.3)
      this.box(
        "volleyball-net-vertical",
        175,
        2.175,
        55 + line,
        0.015,
        0.77,
        0.015,
        net,
      );
    for (const side of [-1, 1]) {
      this.box(
        "volleyball-boundary",
        175 + side * 8,
        0.024,
        55,
        0.055,
        0.015,
        9,
        white,
      );
      this.box(
        "volleyball-boundary",
        175,
        0.024,
        55 + side * 4.5,
        16,
        0.015,
        0.055,
        white,
      );
    }
    this.box("beach-club-platform", 170, 0.15, 118, 16, 0.3, 14, wood);
    this.box(
      "beach-bar",
      170,
      0.85,
      122,
      9,
      1.4,
      1.3,
      this.mat("beach-bar", "#aa9472"),
    );
    for (const dx of [-6.5, 6.5])
      for (const dz of [-5.5, 5.5])
        this.cylinder(
          "pergola-post",
          170 + dx,
          1.75,
          118 + dz,
          0.18,
          3.4,
          white,
        );
    for (let slat = -6.5; slat <= 6.5; slat += 0.65)
      this.box("pergola-roof", 170 + slat, 3.5, 118, 0.22, 0.18, 12, white);
    this.sign("SOLSTICE", 170, 3.15, 112.3, 7.7, 0.65, "#f6ead7", "#8e8069");
    const foamMat = new StandardMaterial("world/sea-foam", this.scene);
    foamMat.diffuseColor = new Color3(0.9, 1, 0.94);
    foamMat.emissiveColor = new Color3(0.11, 0.16, 0.15);
    foamMat.alpha = 0.28;
    foamMat.disableLighting = false;
    this.allMaterials.push(foamMat);
    for (let wave = 0; wave < 8; wave++) {
      const paths: Vector3[][] = [[], []];
      for (let step = 0; step <= 60; step++) {
        const z = -660 + step * 22;
        const x = Math.sin(step * 0.4 + wave) * 1.4;
        paths[0].push(new Vector3(x, 0, z));
        paths[1].push(new Vector3(x + 0.45 + Math.sin(step) * 0.12, 0, z));
      }
      const foam = MeshBuilder.CreateRibbon(
        "shore-break",
        { pathArray: paths, sideOrientation: Mesh.DOUBLESIDE },
        this.scene,
      );
      foam.position.set(211 + wave * 4.3, this.waterLevel + 0.022, 0);
      foam.material = foamMat;
      foam.isPickable = false;
      this.foamMeshes.push(foam);
      this.looseMeshes.push(foam);
    }
  }

  private umbrella(x: number, z: number, color: string): void {
    const canvas = this.mat(
      `umbrella-${color}`,
      color === "coral" ? "#cb8e7b" : "#84aba2",
    );
    const white = this.mat("ivory-trim", "#eee8d8");
    this.cylinder("umbrella-pole", x, 1.38, z, 0.045, 2.77, white);
    const canopy = MeshBuilder.CreateCylinder(
      "beach-umbrella",
      {
        diameterTop: 0.12,
        diameterBottom: 3.6,
        height: 0.58,
        tessellation: 12,
        cap: Mesh.NO_CAP,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      this.scene,
    );
    canopy.position.set(x, 2.57, z);
    this.queue(canopy, canvas);
    for (let rib = 0; rib < 6; rib++) {
      const angle = (rib * Math.PI) / 3;
      this.beam(
        "umbrella-rib",
        new Vector3(x, 2.865, z),
        new Vector3(x + Math.cos(angle) * 1.8, 2.28, z + Math.sin(angle) * 1.8),
        0.025,
        white,
      );
    }
  }

  private lounger(x: number, z: number, rotation = 0, sand = true): void {
    const white = this.mat("ivory-trim", "#eee8d8");
    const y = sand ? 0.32 : 0.6;
    this.box(
      "beach-lounger-seat",
      x,
      y,
      z,
      0.73,
      0.07,
      1.85,
      white,
      "detail",
      false,
      rotation,
    );
    const back = this.box(
      "beach-lounger-back",
      x - Math.sin(rotation) * 0.76,
      y + 0.28,
      z - Math.cos(rotation) * 0.76,
      0.73,
      0.07,
      0.75,
      white,
      "detail",
      false,
      rotation,
    );
    back.rotation.x = -0.65;
  }

  private lifeguardTower(x: number, z: number): void {
    const wall = this.mat("lifeguard-pink", "#d4a39a");
    const white = this.mat("ivory-trim", "#eee8d8");
    for (const dx of [-1, 1])
      for (const dz of [-1, 1])
        this.box(
          "lifeguard-leg",
          x + dx * 1.6,
          1.3,
          z + dz * 1.2,
          0.18,
          2.6,
          0.18,
          white,
        );
    this.box("lifeguard-platform", x, 2.25, z, 4.5, 0.18, 3.6, white);
    this.box("lifeguard-hut", x, 3.19, z, 3.1, 1.7, 2.5, wall, "detail", true);
    this.box(
      "lifeguard-window",
      x + 1.56,
      3.34,
      z,
      0.04,
      0.68,
      1.9,
      this.window,
    );
    this.box(
      "lifeguard-roof",
      x,
      4.2,
      z,
      4.7,
      0.21,
      3.8,
      white,
      "detail",
      true,
    );
    for (let stair = 0; stair < 8; stair++)
      this.box(
        "lifeguard-step",
        x - 2.8 - stair * 0.27,
        2.15 - stair * 0.26,
        z,
        0.34,
        0.1,
        0.9,
        white,
      );
    this.sign(
      "OCEAN RESCUE",
      x,
      3.36,
      z - 1.27,
      2.8,
      0.48,
      "#725f57",
      "#e1baa9",
    );
  }

  private buildMarina(): void {
    const wood = this.mat("marina-deck", "#9c9480");
    const pole = this.mat("marina-post", "#777b70");
    this.box(
      "marina-main-pier",
      231,
      0.48,
      -215,
      49,
      0.45,
      4,
      wood,
      "structure",
      true,
    );
    this.collider("marina-main-pier", 231, 0.48, -215, 49, 0.45, 4);
    for (const z of [-230, -200]) {
      this.box("marina-finger", 249, 0.47, z, 3, 0.42, 28, wood, "structure");
      this.collider("marina-finger", 249, 0.47, z, 3, 0.42, 28);
    }
    for (let x = 211; x <= 255; x += 4) {
      this.box(
        "pier-board-seam",
        x,
        0.717,
        -215,
        0.027,
        0.018,
        3.95,
        this.mat("wood-joint", "#8e826c"),
      );
      for (const side of [-1, 1]) {
        this.cylinder(
          "pier-bollard",
          x,
          0.7,
          -215 + side * 1.72,
          0.25,
          1.28,
          pole,
          0.23,
        );
      }
    }
    this.sign(
      "BAYSIDE MARINA",
      208,
      2.25,
      -217.3,
      7.6,
      0.81,
      "#ece8c9",
      "#4d746b",
    );
  }

  private buildDistantCity(): void {
    // Distant silhouette is provisional coverage, not a completed district.
    const glass = this.mat("skyline-glass", "#718a8e", 0.36, 0.35);
    const pale = this.mat("skyline-concrete", "#c5c8b9");
    const band = this.mat("skyline-window-band", "#879c9b", 0.41, 0.3);
    for (let n = 0; n < 32; n++) {
      const x = -330 - this.rng() * 480;
      const z = -450 + this.rng() * 1250;
      const w = 22 + this.rng() * 26;
      const d = 24 + this.rng() * 26;
      const h = 38 + this.rng() * 102;
      this.box(
        "provisional-skyline-tower",
        x,
        h / 2,
        z,
        w,
        h,
        d,
        n % 3 === 0 ? glass : pale,
        "structure",
      );
      for (let y = 5; y < h - 2; y += 3.7) {
        this.box(
          "skyline-window-floor",
          x,
          y,
          z,
          w + 0.05,
          1.5,
          d + 0.05,
          band,
          "structure",
        );
      }
      this.box(
        "skyline-crown",
        x,
        h + 1.8,
        z,
        w * 0.84,
        3.6,
        d * 0.84,
        pale,
        "structure",
      );
    }
    // A row of tall palms and distant hotels keeps the shoreline continuous.
    for (const sign of [-1, 1])
      for (let n = 0; n < 6; n++) {
        const x = 105 - this.rng() * 45;
        const z = sign * (290 + n * 66);
        const h = 22 + this.rng() * 52;
        this.box(
          "provisional-coastal-tower",
          x,
          h / 2,
          z,
          31,
          h,
          29,
          pale,
          "structure",
        );
        for (let y = 4; y < h; y += 3.6)
          this.box(
            "coastal-balcony-band",
            x,
            y,
            z,
            32.5,
            0.65,
            30.5,
            band,
            "structure",
          );
        this.palm(157, z, 10.3);
      }
  }

  private flushBatches(): void {
    for (const [key, batch] of this.batches) {
      if (!batch.meshes.length) continue;
      const merged = Mesh.MergeMeshes(
        batch.meshes,
        true,
        true,
        undefined,
        false,
        false,
      );
      if (!merged) continue;
      merged.name = `world-chunk/${key}`;
      merged.material = batch.material;
      merged.isPickable = false;
      merged.receiveShadows = true;
      merged.freezeWorldMatrix();
      if (batch.casts) this.ctx.shadows.addShadowCaster(merged, false);
      this.chunks.push({
        meshes: [merged],
        x: batch.x,
        z: batch.z,
        detail: batch.detail,
        active: true,
      });
    }
    this.batches.clear();
  }

  update(dt: number, position: Vector3, time: number, weather: string): void {
    this.age += dt;
    this.lodClock += dt;
    this.waterBump.uOffset = this.age * 0.0008;
    this.waterBump.vOffset = this.age * 0.00045;
    const condition = weather.toLowerCase();
    const rain = condition === "rain" || condition === "storm";
    this.asphalt.roughness = rain ? 0.29 : 0.94;
    this.waterMaterial.roughness = rain ? 0.33 : 0.16;
    for (let n = 0; n < this.foamMeshes.length; n++) {
      const phase = (this.age * 0.45 + n * 4.3) % 34;
      this.foamMeshes[n].position.x = 211 + (34 - phase);
      this.foamMeshes[n].visibility =
        Math.min(1, phase / 5, (34 - phase) / 5) * 0.63;
    }
    const hour = ((time % 24) + 24) % 24;
    const night = Math.max(0, Math.min(1, (Math.abs(hour - 12) - 5) / 2.5));
    if (Math.abs(night - this.lastNight) > 0.02) {
      this.lastNight = night;
      for (const { material, color, intensity } of this.litMaterials)
        material.emissiveColor = color.scale((0.06 + night * 0.94) * intensity);
    }
    if (this.lodClock > 0.6 || dt === 0) {
      this.lodClock = 0;
      for (const chunk of this.chunks) {
        const distance = Math.hypot(position.x - chunk.x, position.z - chunk.z);
        const active = distance < (chunk.detail === "detail" ? 390 : 1700);
        if (active !== chunk.active) {
          for (const mesh of chunk.meshes) mesh.setEnabled(active);
          chunk.active = active;
        }
      }
      for (const mesh of this.looseMeshes) {
        if (!mesh.name.startsWith("sign/")) continue;
        mesh.setEnabled(
          Vector3.DistanceSquared(position, mesh.position) < 410 * 410,
        );
      }
    }
  }

  dispose(): void {
    for (const aggregate of this.aggregates) aggregate.dispose();
    for (const mesh of this.collisionMeshes) mesh.dispose();
    for (const chunk of this.chunks)
      for (const mesh of chunk.meshes) mesh.dispose();
    for (const mesh of this.looseMeshes) mesh.dispose();
    for (const material of this.allMaterials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.boxTemplate.dispose();
    this.chunks.length =
      this.aggregates.length =
      this.collisionMeshes.length =
      this.looseMeshes.length =
        0;
  }
}
