import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  TransformNode,
  Vector3,
  VertexData,
  type Scene,
} from "@babylonjs/core";
import type { BuildContext, VehicleKind } from "../core/contracts";
import { VEHICLE_TUNING } from "./handling";
import type { LatticeDeformation } from "./LatticeDeformation";

export interface WheelVisual {
  pivot: TransformNode;
  tire: Mesh;
  rim: Mesh;
  local: Vector3;
  front: boolean;
  damaged: boolean;
  /** Imported wheels rotate the complete tire/rim/disc hierarchy in this neutral axle frame. */
  rolling?: TransformNode;
}
export interface VehicleModel {
  root: Mesh;
  panels: Mesh[];
  windows: Mesh[];
  bumpers: Mesh[];
  lights: Mesh[];
  wheels: WheelVisual[];
  doors: DoorVisual[];
  rotor?: TransformNode;
  materials: PBRMaterial[];
  deformation?: LatticeDeformation;
  seat?: Vector3;
}
export interface DoorVisual {
  /** Geometry is offset behind this front hinge; detached copies retain their actual shape. */
  mesh: Mesh;
  side: number;
  front: boolean;
  angle: number;
  hold: number;
}

const PALETTE = [
  "#10a69b",
  "#cc3c33",
  "#ceaa54",
  "#20304c",
  "#c8cacf",
  "#455557",
  "#814d6f",
  "#ede4d1",
];

/** A hand-authored cross-section body. Vertex positions remain editable for impact dents. */
function loft(name: string, sections: number[][], scene: Scene, face?: (section: number, side: number) => boolean, caps = true): Mesh {
  const positions: number[] = [],
    indices: number[] = [],
    normals: number[] = [];
  // Each section: z, half-width, lower height, upper height, upper-width ratio.
  for (const [z, w, low, high, taper] of sections)
    positions.push(
      -w,
      low,
      z,
      w,
      low,
      z,
      w * taper,
      high,
      z,
      -w * taper,
      high,
      z,
    );
  for (let s = 0; s < sections.length - 1; s++)
    for (let j = 0; j < 4; j++) {
      if (face && !face(s, j)) continue;
      const a = s * 4 + j,
        b = s * 4 + ((j + 1) % 4),
        c = b + 4,
        d = a + 4;
      indices.push(a, c, b, a, d, c);
    }
  if (caps) indices.push(0, 1, 2, 0, 2, 3);
  const last = (sections.length - 1) * 4;
  if (caps) indices.push(last, last + 2, last + 1, last, last + 3, last + 2);
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(name, scene),
    data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.applyToMesh(mesh, true);
  return mesh;
}

export function createVehicleModel(
  ctx: BuildContext,
  kind: VehicleKind,
  id: number,
  appearanceSeed = id,
): VehicleModel {
  const { scene } = ctx,
    t = VEHICLE_TUNING[kind],
    root = new Mesh(`vehicle-${id}`, scene);
  const materials: PBRMaterial[] = [];
  const material = (
    name: string,
    color: string,
    metallic = 0,
    roughness = 0.5,
  ) => {
    const m = new PBRMaterial(`${name}-${id}`, scene);
    m.albedoColor = Color3.FromHexString(color);
    m.metallic = metallic;
    m.roughness = roughness;
    materials.push(m);
    return m;
  };
  const paint = material(
    "paint",
    kind === "police" ? "#edf0eb" : PALETTE[appearanceSeed % PALETTE.length],
    0.58,
    0.26,
  );
  const black = material("rubber", "#171c22", 0.05, 0.85),
    chrome = material("alloy", "#b5c3c7", 0.87, 0.2);
  const glass = material("glass", "#16343f", 0.3, 0.16);
  glass.alpha = 0.38;
  glass.backFaceCulling = false;
  const dark = material("interior", "#202630", 0.1, 0.67);
  const lamp = material("headlight", "#e9f7fa", 0.1, 0.15);
  lamp.emissiveColor = new Color3(0.7, 0.84, 0.85);
  const tail = material("taillight", "#a91627", 0.18, 0.3);
  tail.emissiveColor = new Color3(0.7, 0.02, 0.02);
  const model: VehicleModel = {
    root,
    panels: [],
    windows: [],
    bumpers: [],
    lights: [],
    wheels: [],
    doors: [],
    materials,
  };
  function parent(mesh: Mesh, mat: PBRMaterial) {
    mesh.material = mat;
    mesh.parent = root;
    mesh.isPickable = true;
    mesh.receiveShadows = true;
    return mesh;
  }
  function box(
    name: string,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat = paint,
  ) {
    const m = parent(
      MeshBuilder.CreateBox(
        `${name}-${id}`,
        { width: w, height: h, depth: d },
        scene,
      ),
      mat,
    );
    m.position.set(x, y, z);
    return m;
  }
  function body(name: string, sections: number[][], mat = paint, face?: (section: number, side: number) => boolean, caps = true) {
    const m = parent(loft(`${name}-${id}`, sections, scene, face, caps), mat);
    model.panels.push(m);
    return m;
  }
  function wheel(x: number, z: number, front: boolean, radius = t.wheelRadius) {
    const pivot = new TransformNode(
      `wheel-pivot-${id}-${model.wheels.length}`,
      scene,
    );
    pivot.parent = root;
    const local = new Vector3(x, 0.13, z);
    pivot.position.copyFrom(local);
    pivot.position.y -= 0.4;
    const tire = MeshBuilder.CreateCylinder(
      `tire-${id}`,
      {
        diameter: radius * 2,
        height: kind === "motorcycle" ? 0.17 : 0.26,
        tessellation: 20,
      },
      scene,
    );
    tire.parent = pivot;
    tire.rotation.z = Math.PI / 2;
    tire.material = black;
    const rim = MeshBuilder.CreateCylinder(
      `rim-${id}`,
      {
        diameter: radius * 1.22,
        height: kind === "motorcycle" ? 0.19 : 0.28,
        tessellation: 12,
      },
      scene,
    );
    rim.parent = pivot;
    rim.rotation.z = Math.PI / 2;
    rim.material = chrome;
    model.wheels.push({ pivot, tire, rim, local, front, damaged: false });
  }
  const half = t.length / 2,
    w = t.width / 2;
  if (["coupe", "sedan", "suv", "police", "truck"].includes(kind)) {
    const high = kind === "suv" || kind === "truck",
      top = high ? 0.46 : 0.3;
    const cabBack = kind === "truck" ? -0.1 : kind === "coupe" ? -0.95 : -1.3,
      cabFront = kind === "truck" ? 1.37 : 1.0,
      roofHeight = high ? 1.28 : 0.94;
    body("coachwork", [
      [-half, w * 0.84, -0.26, 0.08, 0.93],
      [-half + 0.3, w, -0.29, top, 0.98],
      [cabBack + 0.12, w, -0.29, top + 0.06, 0.99],
      [cabFront - 0.15, w, -0.29, top, 0.97],
      [half - 0.32, w * 0.97, -0.23, top - 0.07, 0.97],
      [half, w * 0.8, -0.17, top - 0.13, 0.94],
    ], paint, (section, side) => section !== 2 || side === 0);
    body("roof", [
      [cabBack, w * 0.92, top, top + 0.08, 0.9],
      [cabBack + 0.37, w * 0.9, top, roofHeight, 0.73],
      [cabFront - 0.48, w * 0.87, top, roofHeight, 0.77],
      [cabFront, w * 0.85, top, top + 0.11, 0.93],
    ], paint, (section, side) => section === 1 && side === 2, false);
    // The cabin is open geometry: the roof no longer hides the driver behind a solid volume.
    box("cabin-floor", t.width * 0.86, 0.08, cabFront - cabBack, 0, -0.25, (cabFront + cabBack) / 2, dark);
    box("dashboard", t.width * 0.74, 0.16, 0.28, 0, top + 0.08, cabFront - 0.16, dark);
    for (const side of [-1, 1]) {
      box("front-seat", 0.53, 0.15, 0.53, side * t.width * 0.21, high ? 0.26 : 0.05, -0.08, dark);
      const seat = box("front-seat-back", 0.53, high ? 0.64 : 0.55, 0.14, side * t.width * 0.21, high ? 0.55 : 0.24, -0.34, dark);
      seat.rotation.x = -0.12;
      box("headrest", 0.3, 0.18, 0.13, side * t.width * 0.21, high ? 0.96 : 0.58, -0.37, dark);
      for (const z of [cabBack + 0.22, cabFront - 0.24]) {
        const pillar = box("cab-pillar", 0.075, roofHeight - top, 0.065, side * w * 0.82, (roofHeight + top) / 2, z, paint);
        pillar.rotation.x = z < 0 ? 0.28 : -0.35;
      }
    }
    const steering = parent(MeshBuilder.CreateTorus(`steering-${id}`, { diameter: 0.31, thickness: 0.027, tessellation: 16 }, scene), dark);
    steering.position.set(-t.width * 0.21, top + 0.09, cabFront - 0.43);
    steering.rotation.x = 1.1;
    const windshield = box(
      "windshield",
      t.width * 0.73,
      roofHeight - top - 0.1,
      0.035,
      0,
      (roofHeight + top) / 2,
      cabFront - 0.19,
      glass,
    );
    windshield.rotation.x = -0.53;
    model.windows.push(windshield);
    const backlight = box(
      "backlight",
      t.width * 0.71,
      roofHeight - top - 0.15,
      0.035,
      0,
      (roofHeight + top) / 2,
      cabBack + 0.21,
      glass,
    );
    backlight.rotation.x = 0.46;
    model.windows.push(backlight);
    const windowDepth = (cabFront - cabBack - 0.7) / 2;
    for (const side of [-1, 1]) {
      for (
        let door = 0;
        door < (kind === "coupe" || kind === "truck" ? 1 : 2);
        door++
      ) {
        const dz =
          kind === "coupe" || kind === "truck"
            ? cabFront - cabBack - 0.65
            : windowDepth;
        const z =
          kind === "coupe" || kind === "truck"
            ? (cabBack + cabFront) / 2
            : cabBack + 0.39 + windowDepth * (door + 0.5);
        const doorLength = dz;
        const hinge = box("door", 0.085, top + 0.24, doorLength, side * (w - 0.045), (top - 0.24) / 2, z, paint);
        hinge.bakeTransformIntoVertices(Matrix.Translation(0, 0, -doorLength / 2));
        hinge.position.z = z + doorLength / 2;
        const mount = (part: Mesh) => { part.setParent(hinge); return part; };
        model.doors.push({ mesh: hinge, side, front: door === (kind === "coupe" || kind === "truck" ? 0 : 1), angle: 0, hold: 0 });
        const window = box(
          "side-window",
          0.025,
          (roofHeight - top) * 0.71,
          dz - 0.06,
          side * w * 0.807,
          (roofHeight + top) / 2,
          z,
          glass,
        );
        window.rotation.z = side * 0.14;
        mount(window);
        model.windows.push(window);
        mount(box(
          "door-handle",
          0.04,
          0.055,
          0.23,
          side * (w + 0.005),
          top - 0.09,
          z - 0.26,
          chrome,
        ));
        mount(box("door-frame-top", 0.04, 0.045, dz, side * w * 0.77, roofHeight - 0.045, z, paint));
        mount(box("door-frame-back", 0.04, roofHeight - top, 0.055, side * w * 0.81, (roofHeight + top) / 2, z - dz / 2, paint));
        mount(box("door-trim", 0.04, 0.13, dz * 0.84, side * (w - 0.1), top - 0.11, z, dark));
      }
      box("rocker", 0.095, 0.1, t.length * 0.72, side * w, -0.26, 0, dark);
      const mirror = box(
        "mirror",
        0.21,
        0.14,
        0.27,
        side * (w + 0.09),
        top + 0.26,
        cabFront - 0.2,
      );
      const mirrorGlass = box(
        "mirror-glass",
        0.13,
        0.1,
        0.03,
        side * (w + 0.1),
        top + 0.27,
        cabFront - 0.34,
        chrome,
      );
      mirror.rotation.y = side * 0.12;
      const door = model.doors.find(d => d.side === side && d.front);
      if (door) { mirror.setParent(door.mesh); mirrorGlass.setParent(door.mesh); }
    }
    if (kind === "truck") {
      box("bed-floor", t.width * 0.84, 0.08, 2.16, 0, top - 0.17, -1.52, dark);
      for (const side of [-1, 1])
        box("bed-rail", 0.11, 0.36, 2.15, side * w * 0.86, top + 0.05, -1.52);
      box("tailgate", t.width * 0.9, 0.42, 0.14, 0, top - 0.01, -half + 0.1);
    }
    if (kind === "coupe") {
      for (const side of [-1, 1]) {
        const stripe = box(
          "spoiler-bracket",
          0.055,
          0.15,
          0.13,
          side * 0.52,
          top + 0.17,
          -half + 0.46,
          dark,
        );
        const door = model.doors.find(d => d.side === side && d.front);
        if (door) stripe.setParent(door.mesh);
      }
      box(
        "spoiler",
        t.width * 0.84,
        0.075,
        0.29,
        0,
        top + 0.27,
        -half + 0.46,
        dark,
      );
    }
    if (high)
      for (const side of [-1, 1])
        box(
          "roof-rail",
          0.05,
          0.06,
          1.83,
          side * w * 0.7,
          roofHeight + 0.05,
          -0.05,
          chrome,
        );
    for (const front of [-1, 1]) {
      const bumper = box(
        front > 0 ? "front-bumper" : "rear-bumper",
        t.width * 0.94,
        0.18,
        0.18,
        0,
        -0.13,
        front * (half - 0.015),
        kind === "police" ? dark : paint,
      );
      model.bumpers.push(bumper);
      box(
        "license-plate",
        0.39,
        0.13,
        0.02,
        0,
        -0.03,
        front * (half + 0.08),
        chrome,
      );
      for (const side of [-1, 1])
        model.lights.push(
          box(
            front > 0 ? "headlight" : "taillight",
            t.width * 0.235,
            0.135,
            0.045,
            side * w * 0.64,
            0.1,
            front * (half - 0.005),
            front > 0 ? lamp : tail,
          ),
        );
    }
    box("grille", t.width * 0.4, 0.17, 0.032, 0, 0.11, half + 0.015, dark);
    for (let slat = -2; slat <= 2; slat++)
      box(
        "grille-slat",
        0.025,
        0.13,
        0.015,
        slat * 0.105,
        0.11,
        half + 0.04,
        chrome,
      );
    for (const side of [-1, 1])
      for (const axle of [-1, 1])
        wheel(side * (w - 0.015), (axle * t.wheelbase) / 2, axle > 0);
    if (kind === "police") {
      box(
        "black-hood",
        t.width * 0.82,
        0.035,
        1.08,
        0,
        top + 0.015,
        1.58,
        dark,
      );
      box("lightbar-base", 1.12, 0.055, 0.26, 0, roofHeight + 0.04, -0.1, dark);
      const red = material("police-red", "#db1138", 0.2, 0.3);
      red.emissiveColor = new Color3(1, 0.015, 0.03);
      const blue = material("police-blue", "#135ce5", 0.2, 0.3);
      blue.emissiveColor = new Color3(0.02, 0.1, 1);
      box("police-red", 0.48, 0.13, 0.23, -0.3, roofHeight + 0.13, -0.1, red);
      box("police-blue", 0.48, 0.13, 0.23, 0.3, roofHeight + 0.13, -0.1, blue);
      box("pushbar", 1.05, 0.38, 0.09, 0, -0.015, half + 0.13, dark);
      for (const side of [-1, 1])
        box(
          "police-door-stripe",
          0.021,
          0.2,
          1.1,
          side * (w + 0.015),
          0.06,
          -0.04,
          dark,
        );
    }
  } else if (kind === "motorcycle") {
    body("tank", [
      [-0.5, 0.22, -0.05, 0.34, 0.65],
      [0.1, 0.28, -0.08, 0.53, 0.6],
      [0.48, 0.17, -0.03, 0.3, 0.8],
    ]);
    box("saddle", 0.39, 0.15, 0.72, 0, 0.3, -0.57, dark);
    box("engine", 0.4, 0.36, 0.43, 0, -0.13, 0, chrome);
    box("footpegs", 0.74, 0.035, 0.07, 0, -0.33, -0.18, chrome);
    for (const side of [-1, 1]) {
      const fork = box(
        "fork",
        0.06,
        0.75,
        0.07,
        side * 0.13,
        -0.02,
        0.71,
        chrome,
      );
      fork.rotation.x = -0.18;
    }
    box("handlebar", 0.78, 0.055, 0.08, 0, 0.64, 0.55, chrome);
    model.lights.push(box("headlight", 0.3, 0.23, 0.1, 0, 0.45, 0.78, lamp));
    wheel(0, -t.wheelbase / 2, false);
    wheel(0, t.wheelbase / 2, true);
  } else if (kind === "boat") {
    body("hull", [
      [-half, w * 0.72, -0.47, 0.35, 1.0],
      [-half + 0.5, w, -0.55, 0.39, 0.94],
      [half * 0.44, w * 0.94, -0.51, 0.47, 0.93],
      [half - 0.35, w * 0.37, -0.16, 0.53, 0.9],
      [half, 0.02, 0.19, 0.5, 1],
    ]);
    box("cockpit-floor", 1.8, 0.09, 2.6, 0, 0.41, -0.45, dark);
    for (const side of [-1, 1])
      box("hull-rail", 0.08, 0.06, 3.7, side * w * 0.89, 0.55, -0.5, chrome);
    const windshield = box(
      "boat-windshield",
      1.68,
      0.55,
      0.05,
      0,
      0.72,
      0.74,
      glass,
    );
    windshield.rotation.x = -0.3;
    model.windows.push(windshield);
    for (const side of [-1, 1]) {
      box("seat-base", 0.58, 0.35, 0.65, side * 0.49, 0.61, -0.22, paint);
      box("seat-back", 0.58, 0.65, 0.13, side * 0.49, 0.9, -0.52, dark);
    }
    box("rear-bench", 1.7, 0.3, 0.52, 0, 0.6, -1.78, paint);
    box("outboard-motor", 0.48, 0.85, 0.47, 0, -0.08, -half - 0.15, dark);
  } else if (kind === "helicopter") {
    body("fuselage", [
      [-2.15, 0.27, -0.4, 0.63, 0.7],
      [-1.2, 0.89, -0.57, 1.12, 0.64],
      [0.78, 0.95, -0.54, 1.0, 0.72],
      [1.81, 0.52, -0.3, 0.6, 0.6],
      [2.14, 0.14, -0.1, 0.35, 0.7],
    ]);
    const window = body(
      "cockpit-canopy",
      [
        [0.8, 0.92, -0.12, 0.92, 0.65],
        [1.69, 0.58, -0.22, 0.61, 0.59],
        [2.1, 0.13, -0.04, 0.32, 0.7],
      ],
      glass,
    );
    model.windows.push(window);
    body("tail-boom", [
      [-5.05, 0.11, 0.18, 0.47, 0.8],
      [-1.85, 0.32, -0.1, 0.53, 0.9],
    ]);
    box("tail-fin", 0.12, 1.23, 0.73, 0, 0.78, -4.74);
    box("tailplane", 2.3, 0.09, 0.5, 0, 0.31, -4.1);
    for (const side of [-1, 1]) {
      box("skid", 0.09, 0.09, 3.3, side * 0.92, -0.79, 0.1, dark);
      box("skid-strut", 0.065, 0.56, 0.07, side * 0.72, -0.52, -0.68, chrome);
      box("skid-strut", 0.065, 0.56, 0.07, side * 0.72, -0.52, 0.78, chrome);
    }
    box("mast", 0.14, 0.54, 0.14, 0, 1.32, -0.24, chrome);
    const rotor = new TransformNode(`rotor-${id}`, scene);
    rotor.parent = root;
    rotor.position.set(0, 1.57, -0.24);
    for (let i = 0; i < 2; i++) {
      const blade = box("rotor-blade", 9.6, 0.035, 0.15, 0, 0, 0, dark);
      blade.parent = rotor;
      blade.position.setAll(0);
      blade.rotation.y = (i * Math.PI) / 2;
    }
    model.rotor = rotor;
    const tailRotor = box(
      "tail-rotor",
      0.055,
      1.4,
      0.1,
      0.2,
      0.46,
      -4.95,
      dark,
    );
    tailRotor.rotation.x = 0.3;
  } else if (kind === "plane") {
    body("fuselage", [
      [-3.7, 0.12, -0.03, 0.29, 0.8],
      [-1.1, 0.63, -0.43, 0.7, 0.72],
      [0.55, 0.68, -0.47, 0.68, 0.7],
      [2.69, 0.37, -0.23, 0.4, 0.85],
      [3.5, 0.12, -0.07, 0.2, 0.9],
    ]);
    body("wings", [
      [-0.65, 5.3, 0.05, 0.17, 0.95],
      [0.25, 5.3, 0.05, 0.17, 0.95],
      [0.82, 1.01, 0.05, 0.17, 0.95],
    ]);
    box("tailplane", 3.8, 0.09, 1.15, 0, 0.19, -3.1);
    box("tailfin", 0.09, 1.58, 1.15, 0, 0.76, -3.05);
    const window = body(
      "canopy",
      [
        [-0.91, 0.56, 0.57, 0.67, 0.8],
        [-0.59, 0.52, 0.63, 1.1, 0.8],
        [0.51, 0.53, 0.62, 1.09, 0.75],
        [0.91, 0.5, 0.42, 0.65, 0.9],
      ],
      glass,
    );
    model.windows.push(window);
    for (const side of [-1, 1]) wheel(side * 1.07, -0.27, false, 0.28);
    wheel(0, 2.05, true, 0.24);
    const rotor = new TransformNode(`propeller-${id}`, scene);
    rotor.parent = root;
    rotor.position.set(0, 0.17, 3.63);
    const blade = box("propeller", 0.12, 2.03, 0.035, 0, 0, 0, dark);
    blade.parent = rotor;
    blade.position.setAll(0);
    model.rotor = rotor;
  }
  // Associate every pickable component with its rigid-body entity for projectile/interaction lookup.
  root.metadata = { vehicleId: `vehicle-${id}`, vehicleKind: kind };
  for (const mesh of root.getChildMeshes()) mesh.metadata = root.metadata;
  ctx.shadows.addShadowCaster(root, true);
  return model;
}
