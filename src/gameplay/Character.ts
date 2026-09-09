import {
  Bone,
  BoundingInfo,
  Color3,
  Matrix,
  Mesh,
  PBRMaterial,
  Quaternion,
  Skeleton,
  TransformNode,
  Vector3,
  VertexData,
  type Scene,
  type ShadowGenerator,
} from "@babylonjs/core";

type Joint =
  | "pelvis"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "leftArm"
  | "leftForearm"
  | "leftHand"
  | "rightArm"
  | "rightForearm"
  | "rightHand"
  | "leftThigh"
  | "leftCalf"
  | "leftFoot"
  | "rightThigh"
  | "rightCalf"
  | "rightFoot";
type Influence = [Joint, number];
type Ring = { y: number; w: number; d: number; x?: number; z?: number };
type SharedMaterial = { material: PBRMaterial; users: number };
const characterMaterials = new WeakMap<Scene, SharedMaterial>();

/** Original, metre-scale, vertex-colored character asset with a real Babylon skin rig.
 * Proportions and animation are authored approximations, not Rockstar character assets.
 */
export class Character {
  readonly root: TransformNode;
  readonly torso: Mesh;
  readonly parts: Mesh[];
  readonly skeleton: Skeleton;
  phase = 0;
  dead = false;
  private readonly bones = new Map<Joint, Bone>();
  private readonly boneIndex = new Map<Joint, number>();
  private readonly material: SharedMaterial;
  private readonly scene: Scene;
  private readonly baseHeight: number;
  private readonly rotation = Quaternion.Identity();
  private readonly pelvisPosition = Vector3.Zero();
  private movement = 0;
  private aiming = 0;
  private crouching = 0;
  private elapsed = 0;
  private disposed = false;

  constructor(
    scene: Scene,
    shadows: ShadowGenerator,
    name: string,
    color = "#d9c3a7",
    female = false,
    trousers?: string,
  ) {
    this.scene = scene;
    this.baseHeight = female ? 0.98 : 1.015;
    this.root = new TransformNode(name, scene);
    this.skeleton = new Skeleton(name + "/skeleton", name + "/skeleton", scene);
    const positions: Record<Joint, Vector3> = {
      pelvis: new Vector3(0, this.baseHeight, 0),
      spine: new Vector3(0, 1.14, 0),
      chest: new Vector3(0, 1.39, 0),
      neck: new Vector3(0, 1.525, 0),
      head: new Vector3(0, 1.6, 0),
      leftArm: new Vector3(-0.215, 1.425, 0),
      leftForearm: new Vector3(-0.241, 1.145, 0.008),
      leftHand: new Vector3(-0.248, 0.91, 0.012),
      rightArm: new Vector3(0.215, 1.425, 0),
      rightForearm: new Vector3(0.241, 1.145, 0.008),
      rightHand: new Vector3(0.248, 0.91, 0.012),
      leftThigh: new Vector3(-0.105, 0.94, 0),
      leftCalf: new Vector3(-0.108, 0.53, 0.016),
      leftFoot: new Vector3(-0.108, 0.13, 0.005),
      rightThigh: new Vector3(0.105, 0.94, 0),
      rightCalf: new Vector3(0.108, 0.53, 0.016),
      rightFoot: new Vector3(0.108, 0.13, 0.005),
    };
    const hierarchy: [Joint, Joint | null][] = [
      ["pelvis", null],
      ["spine", "pelvis"],
      ["chest", "spine"],
      ["neck", "chest"],
      ["head", "neck"],
      ["leftArm", "chest"],
      ["leftForearm", "leftArm"],
      ["leftHand", "leftForearm"],
      ["rightArm", "chest"],
      ["rightForearm", "rightArm"],
      ["rightHand", "rightForearm"],
      ["leftThigh", "pelvis"],
      ["leftCalf", "leftThigh"],
      ["leftFoot", "leftCalf"],
      ["rightThigh", "pelvis"],
      ["rightCalf", "rightThigh"],
      ["rightFoot", "rightCalf"],
    ];
    for (const [joint, parent] of hierarchy) {
      const local = parent
        ? positions[joint].subtract(positions[parent])
        : positions[joint];
      const matrix = Matrix.Translation(local.x, local.y, local.z);
      const bone = new Bone(
        name + "/" + joint,
        this.skeleton,
        parent ? this.bones.get(parent)! : null,
        matrix,
        matrix.clone(),
        matrix.clone(),
      );
      this.boneIndex.set(joint, this.skeleton.bones.length - 1);
      this.bones.set(joint, bone);
    }
    let shared = characterMaterials.get(scene);
    if (!shared) {
      const material = new PBRMaterial(
        "characters/vertex-color-cloth-and-skin",
        scene,
      );
      material.albedoColor = Color3.White();
      material.roughness = 0.83;
      material.metallic = 0;
      material.environmentIntensity = 0.6;
      shared = { material, users: 0 };
      characterMaterials.set(scene, shared);
    }
    this.material = shared;
    shared.users++;

    const data = new VertexData();
    const vertices: number[] = [],
      indices: number[] = [],
      colors: number[] = [],
      weights: number[] = [],
      boneIndices: number[] = [];
    const skin = Color3.FromHexString(female ? "#bf8d72" : "#bd9478");
    const shirt = Color3.FromHexString(color);
    const denim = Color3.FromHexString(trousers ?? (female ? "#3b5262" : "#485867"));
    const darkDenim = denim.scale(0.74);
    const hair = Color3.FromHexString(female ? "#352921" : "#493b30");
    const shoe = Color3.FromHexString("#353430");
    const sole = Color3.FromHexString("#958f7e");
    const light = Color3.FromHexString("#dedacc");
    const lip = Color3.FromHexString("#845f50");
    const eye = Color3.FromHexString("#352f29");
    const vertex = (
      x: number,
      y: number,
      z: number,
      c: Color3,
      influences: Influence[],
    ) => {
      vertices.push(x, y, z);
      colors.push(c.r, c.g, c.b, 1);
      for (let n = 0; n < 4; n++) {
        const influence = influences[n];
        boneIndices.push(influence ? this.boneIndex.get(influence[0])! : 0);
        weights.push(influence ? influence[1] : 0);
      }
    };
    const blend = (a: Joint, b: Joint, value: number): Influence[] => {
      const weight = Math.max(0, Math.min(1, value));
      return [
        [a, 1 - weight],
        [b, weight],
      ];
    };
    const rigid =
      (joint: Joint) =>
      (_: number): Influence[] => [[joint, 1]];
    const bodyWeights = (y: number): Influence[] =>
      y < 1.19
        ? blend("pelvis", "spine", (y - 1.03) / 0.16)
        : blend("spine", "chest", (y - 1.2) / 0.22);
    const loft = (
      rings: Ring[],
      material: Color3,
      influence: (y: number) => Influence[],
      segments = 16,
      variation = 0.018,
    ) => {
      const start = vertices.length / 3;
      for (let row = 0; row < rings.length; row++) {
        const r = rings[row];
        for (let n = 0; n < segments; n++) {
          const angle = (n / segments) * Math.PI * 2;
          const shade = 1 + Math.sin(angle * 3 + row * 0.8) * variation;
          vertex(
            (r.x || 0) + Math.cos(angle) * r.w,
            r.y,
            (r.z || 0) + Math.sin(angle) * r.d,
            material.scale(shade),
            influence(r.y),
          );
        }
      }
      for (let row = 0; row < rings.length - 1; row++)
        for (let n = 0; n < segments; n++) {
          const a = start + row * segments + n,
            b = start + row * segments + ((n + 1) % segments),
            c = a + segments,
            d = b + segments;
          indices.push(a, c, b, b, c, d);
        }
      const bottom = rings[0],
        top = rings[rings.length - 1];
      const bottomIndex = vertices.length / 3;
      vertex(
        bottom.x || 0,
        bottom.y,
        bottom.z || 0,
        material,
        influence(bottom.y),
      );
      const topIndex = vertices.length / 3;
      vertex(top.x || 0, top.y, top.z || 0, material, influence(top.y));
      for (let n = 0; n < segments; n++) {
        indices.push(bottomIndex, start + n, start + ((n + 1) % segments));
        const last = start + (rings.length - 1) * segments;
        indices.push(topIndex, last + ((n + 1) % segments), last + n);
      }
    };
    const ellipsoid = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      material: Color3,
      joint: Joint,
      segments = 12,
    ) => {
      const rings: Ring[] = [];
      for (let row = 0; row <= 8; row++) {
        const angle = -Math.PI / 2 + (row / 8) * Math.PI;
        rings.push({
          x,
          y: y + Math.sin(angle) * h,
          z,
          w: Math.max(0.0001, Math.cos(angle) * w),
          d: Math.max(0.0001, Math.cos(angle) * d),
        });
      }
      loft(rings, material, rigid(joint), segments, 0);
    };
    const band = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      material: Color3,
      joint: Joint,
    ) => {
      loft(
        [
          { x, y: y - h / 2, z, w, d },
          { x, y: y + h / 2, z, w, d },
        ],
        material,
        rigid(joint),
        12,
        0,
      );
    };

    // Tailored torso: tapered waist, natural rib cage, sloping shoulders and collar.
    const shoulder = female ? 0.205 : 0.236;
    loft(
      [
        { y: 1.015, w: female ? 0.147 : 0.158, d: 0.109, z: 0 },
        { y: 1.04, w: female ? 0.151 : 0.166, d: 0.112, z: 0.003 },
        { y: 1.12, w: female ? 0.142 : 0.17, d: 0.103, z: 0.004 },
        { y: 1.21, w: female ? 0.155 : 0.189, d: 0.112, z: 0.008 },
        { y: 1.31, w: female ? 0.181 : 0.209, d: 0.129, z: 0.01 },
        { y: 1.39, w: shoulder, d: 0.127, z: 0.005 },
        { y: 1.455, w: shoulder * 0.95, d: 0.106, z: 0 },
        { y: 1.482, w: shoulder * 0.67, d: 0.085, z: -0.008 },
        { y: 1.509, w: 0.069, d: 0.066, z: -0.003 },
      ],
      shirt,
      bodyWeights,
      20,
    );
    loft(
      [
        { y: 1.027, w: female ? 0.155 : 0.17, d: 0.115 },
        { y: 1.047, w: female ? 0.157 : 0.171, d: 0.116 },
      ],
      shirt.scale(0.84),
      bodyWeights,
      20,
      0,
    );
    loft(
      [
        { y: 1.494, w: 0.082, d: 0.074, z: -0.001 },
        { y: 1.519, w: 0.07, d: 0.066, z: -0.001 },
      ],
      shirt.scale(0.73),
      bodyWeights,
      16,
      0,
    );
    loft(
      [
        { y: 1.467, w: 0.064, d: 0.058, z: 0 },
        { y: 1.54, w: 0.062, d: 0.059, z: 0 },
        { y: 1.6, w: 0.071, d: 0.064, z: 0.004 },
      ],
      skin,
      (y) => blend("chest", "head", (y - 1.48) / 0.12),
      16,
    );
    // Jeans are a continuous waist and hip volume with creases, pockets and belt.
    loft(
      [
        { y: 0.818, w: 0.161, d: 0.091, z: -0.012 },
        { y: 0.91, w: female ? 0.179 : 0.17, d: 0.124, z: -0.012 },
        { y: 1.012, w: female ? 0.17 : 0.166, d: 0.123, z: -0.001 },
        { y: 1.048, w: female ? 0.155 : 0.16, d: 0.115, z: 0 },
      ],
      denim,
      rigid("pelvis"),
      20,
    );
    band(
      0,
      1.042,
      0,
      female ? 0.157 : 0.163,
      0.024,
      0.118,
      darkDenim,
      "pelvis",
    );
    ellipsoid(0, 1.043, 0.119, 0.018, 0.014, 0.005, sole, "pelvis", 8);
    for (const side of [-1, 1]) {
      ellipsoid(
        side * 0.086,
        0.944,
        -0.125,
        0.047,
        0.054,
        0.004,
        darkDenim,
        "pelvis",
        10,
      );
      ellipsoid(
        side * 0.086,
        0.989,
        -0.127,
        0.046,
        0.003,
        0.004,
        denim.scale(1.25),
        "pelvis",
        10,
      );
    }

    for (const side of [-1, 1]) {
      const left = side < 0;
      const upper: Joint = left ? "leftArm" : "rightArm",
        fore: Joint = left ? "leftForearm" : "rightForearm",
        hand: Joint = left ? "leftHand" : "rightHand";
      const thigh: Joint = left ? "leftThigh" : "rightThigh",
        calf: Joint = left ? "leftCalf" : "rightCalf",
        foot: Joint = left ? "leftFoot" : "rightFoot";
      const armWeights = (y: number): Influence[] =>
        y > 1.385
          ? blend(upper, "chest", (y - 1.385) / 0.1)
          : y < 1.21
            ? blend(fore, upper, (y - 1.105) / 0.105)
            : [[upper, 1]];
      const sleeveEnd = female ? 1.331 : 1.278;
      loft(
        [
          {
            x: side * 0.238,
            y: sleeveEnd,
            w: female ? 0.058 : 0.07,
            d: 0.07,
            z: 0.005,
          },
          {
            x: side * 0.235,
            y: 1.38,
            w: female ? 0.067 : 0.083,
            d: 0.084,
            z: 0,
          },
          {
            x: side * 0.209,
            y: 1.454,
            w: female ? 0.058 : 0.071,
            d: 0.08,
            z: 0,
          },
          { x: side * 0.18, y: 1.475, w: 0.04, d: 0.062, z: 0 },
        ],
        shirt,
        armWeights,
        14,
      );
      loft(
        [
          { x: side * 0.248, y: 0.903, w: 0.033, d: 0.033, z: 0.012 },
          { x: side * 0.247, y: 0.96, w: 0.041, d: 0.038, z: 0.012 },
          { x: side * 0.245, y: 1.04, w: 0.048, d: 0.045, z: 0.009 },
          { x: side * 0.242, y: 1.112, w: 0.043, d: 0.043, z: 0.009 },
          { x: side * 0.24, y: 1.17, w: 0.047, d: 0.044, z: 0.008 },
          {
            x: side * 0.236,
            y: 1.25,
            w: female ? 0.052 : 0.061,
            d: 0.056,
            z: 0.005,
          },
          {
            x: side * 0.232,
            y: sleeveEnd + 0.045,
            w: female ? 0.057 : 0.064,
            d: 0.061,
            z: 0.003,
          },
        ],
        skin,
        (y) =>
          y < 0.935 ? blend(hand, fore, (y - 0.905) / 0.03) : armWeights(y),
        14,
      );
      // Palms and thumbs replace ball hands.
      loft(
        [
          { x: side * 0.251, y: 0.779, w: 0.027, d: 0.021, z: 0.026 },
          { x: side * 0.25, y: 0.815, w: 0.039, d: 0.026, z: 0.023 },
          { x: side * 0.249, y: 0.871, w: 0.041, d: 0.029, z: 0.017 },
          { x: side * 0.248, y: 0.926, w: 0.032, d: 0.033, z: 0.012 },
        ],
        skin,
        rigid(hand),
        12,
      );
      ellipsoid(side * 0.214, 0.842, 0.033, 0.015, 0.04, 0.017, skin, hand, 8);
      const legWeights = (y: number): Influence[] =>
        y > 0.865
          ? blend(thigh, "pelvis", (y - 0.865) / 0.115)
          : y > 0.61
            ? [[thigh, 1]]
            : y > 0.46
              ? blend(calf, thigh, (y - 0.46) / 0.15)
              : y < 0.2
                ? blend(foot, calf, (y - 0.125) / 0.075)
                : [[calf, 1]];
      loft(
        [
          { x: side * 0.108, y: 0.125, w: 0.061, d: 0.062, z: 0.008 },
          { x: side * 0.108, y: 0.19, w: 0.064, d: 0.066, z: 0.008 },
          { x: side * 0.108, y: 0.29, w: 0.073, d: 0.073, z: -0.001 },
          { x: side * 0.108, y: 0.39, w: 0.077, d: 0.078, z: 0.008 },
          { x: side * 0.108, y: 0.49, w: 0.067, d: 0.07, z: 0.021 },
          { x: side * 0.108, y: 0.555, w: 0.071, d: 0.074, z: 0.025 },
          { x: side * 0.107, y: 0.64, w: 0.084, d: 0.084, z: 0.009 },
          { x: side * 0.106, y: 0.74, w: 0.097, d: 0.092, z: -0.004 },
          {
            x: side * 0.105,
            y: 0.85,
            w: female ? 0.102 : 0.104,
            d: 0.104,
            z: -0.009,
          },
          { x: side * 0.097, y: 0.93, w: 0.104, d: 0.113, z: -0.009 },
        ],
        denim,
        legWeights,
        16,
      );
      loft(
        [
          { x: side * 0.108, y: 0.145, w: 0.064, d: 0.066, z: 0.008 },
          { x: side * 0.108, y: 0.169, w: 0.066, d: 0.068, z: 0.008 },
        ],
        darkDenim,
        legWeights,
        16,
        0,
      );
      // Shoes have flat soles, a broad toe box, heel and raised tongue.
      loft(
        [
          { x: side * 0.108, y: 0.022, w: 0.077, d: 0.14, z: 0.057 },
          { x: side * 0.108, y: 0.05, w: 0.079, d: 0.143, z: 0.057 },
          { x: side * 0.108, y: 0.091, w: 0.074, d: 0.132, z: 0.053 },
          { x: side * 0.108, y: 0.142, w: 0.059, d: 0.085, z: 0.011 },
        ],
        shoe,
        rigid(foot),
        16,
      );
      loft(
        [
          { x: side * 0.108, y: 0.009, w: 0.078, d: 0.141, z: 0.057 },
          { x: side * 0.108, y: 0.031, w: 0.08, d: 0.145, z: 0.057 },
        ],
        sole,
        rigid(foot),
        16,
        0,
      );
      for (let lace = 0; lace < 3; lace++)
        ellipsoid(
          side * 0.108,
          0.113 - lace * 0.008,
          0.04 + lace * 0.026,
          0.048,
          0.004,
          0.005,
          light,
          foot,
          8,
        );
    }

    // Modeled jaw, chin, cheekbones and brow replace the spherical head.
    loft(
      [
        { y: 1.573, w: 0.042, d: 0.047, z: 0.027 },
        { y: 1.593, w: 0.061, d: 0.061, z: 0.02 },
        { y: 1.626, w: 0.081, d: 0.077, z: 0.013 },
        { y: 1.659, w: 0.097, d: 0.091, z: 0.009 },
        { y: 1.699, w: 0.107, d: 0.104, z: 0.004 },
        { y: 1.742, w: 0.108, d: 0.103, z: 0 },
        { y: 1.785, w: 0.097, d: 0.094, z: -0.005 },
        { y: 1.818, w: 0.071, d: 0.072, z: -0.006 },
        { y: 1.839, w: 0.022, d: 0.026, z: -0.007 },
      ],
      skin,
      rigid("head"),
      20,
      0.012,
    );
    for (const side of [-1, 1]) {
      ellipsoid(
        side * 0.109,
        1.678,
        -0.005,
        0.014,
        0.035,
        0.022,
        skin,
        "head",
        10,
      );
      ellipsoid(
        side * 0.12,
        1.679,
        0.001,
        0.004,
        0.02,
        0.01,
        skin.scale(0.79),
        "head",
        8,
      );
      ellipsoid(
        side * 0.046,
        1.705,
        0.1,
        0.023,
        0.009,
        0.012,
        skin.scale(0.94),
        "head",
        12,
      );
      ellipsoid(
        side * 0.046,
        1.705,
        0.11,
        0.017,
        0.0058,
        0.004,
        light,
        "head",
        10,
      );
      ellipsoid(
        side * 0.046,
        1.705,
        0.114,
        0.0065,
        0.006,
        0.0017,
        eye,
        "head",
        8,
      );
      ellipsoid(
        side * 0.047,
        1.721,
        0.105,
        0.025,
        0.004,
        0.004,
        hair,
        "head",
        10,
      );
    }
    ellipsoid(0, 1.685, 0.108, 0.014, 0.029, 0.022, skin, "head", 12);
    ellipsoid(0, 1.665, 0.125, 0.02, 0.013, 0.016, skin, "head", 12);
    for (const side of [-1, 1])
      ellipsoid(
        side * 0.013,
        1.658,
        0.122,
        0.006,
        0.004,
        0.004,
        skin.scale(0.73),
        "head",
        8,
      );
    ellipsoid(0, 1.632, 0.092, 0.027, 0.0048, 0.006, lip, "head", 12);
    ellipsoid(
      0,
      1.623,
      0.088,
      0.025,
      0.005,
      0.005,
      skin.scale(0.93),
      "head",
      12,
    );
    loft(
      [
        { y: female ? 1.72 : 1.761, w: 0.109, d: 0.104, z: -0.012 },
        { y: 1.785, w: 0.102, d: 0.099, z: -0.013 },
        { y: 1.824, w: 0.078, d: 0.079, z: -0.012 },
        { y: 1.851, w: 0.031, d: 0.034, z: -0.01 },
        { y: 1.854, w: 0.004, d: 0.005, z: -0.01 },
      ],
      hair,
      rigid("head"),
      20,
      0.038,
    );
    if (female) {
      ellipsoid(0, 1.722, -0.113, 0.071, 0.093, 0.033, hair, "head", 14);
      ellipsoid(0, 1.585, -0.124, 0.043, 0.147, 0.043, hair, "head", 12);
      band(0, 1.702, -0.135, 0.052, 0.025, 0.041, shoe, "head");
    } else {
      for (const side of [-1, 1])
        ellipsoid(
          side * 0.101,
          1.718,
          -0.007,
          0.008,
          0.034,
          0.046,
          hair,
          "head",
          10,
        );
      ellipsoid(
        0,
        1.609,
        0.072,
        0.048,
        0.012,
        0.015,
        skin.scale(0.76),
        "head",
        12,
      );
    }

    // Babylon uses clockwise front faces in its default left-handed scene.
    for (let triangle = 0; triangle < indices.length; triangle += 3) {
      const swap = indices[triangle + 1];
      indices[triangle + 1] = indices[triangle + 2];
      indices[triangle + 2] = swap;
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(vertices, indices, normals);
    data.positions = vertices;
    data.indices = indices;
    data.normals = normals;
    data.colors = colors;
    data.matricesIndices = boneIndices;
    data.matricesWeights = weights;
    this.torso = new Mesh(name + "/skinned-body", scene);
    data.applyToMesh(this.torso, false);
    this.torso.parent = this.root;
    this.torso.material = shared.material;
    this.torso.skeleton = this.skeleton;
    this.torso.useVertexColors = true;
    this.torso.hasVertexAlpha = false;
    this.torso.numBoneInfluencers = 4;
    this.torso.isPickable = true;
    this.torso.receiveShadows = true;
    this.torso.setBoundingInfo(
      new BoundingInfo(
        new Vector3(-0.7, -0.12, -0.7),
        new Vector3(0.7, 1.96, 0.95),
      ),
    );
    this.parts = [this.torso];
    shadows.addShadowCaster(this.torso, false);
    this.skeleton.prepare();
  }

  private rotate(joint: Joint, x: number, y = 0, z = 0): void {
    Quaternion.RotationYawPitchRollToRef(y, x, z, this.rotation);
    this.bones.get(joint)!.setRotationQuaternion(this.rotation);
  }

  animate(dt: number, speed: number, aim = false, crouch = false): void {
    this.elapsed += dt;
    const smooth = 1 - Math.exp(-dt * 11);
    this.movement +=
      (Math.min(Math.abs(speed) / 4.2, 1) - this.movement) * smooth;
    this.aiming += (Number(aim) - this.aiming) * smooth;
    this.crouching += (Number(crouch) - this.crouching) * smooth;
    this.phase +=
      dt *
      (Math.abs(speed) > 0.08
        ? 4.5 + Math.min(Math.abs(speed), 8) * 1.06
        : 1.2);
    const c = this.crouching,
      a = this.aiming,
      run = Math.max(0, Math.min(1, (speed - 4) / 3));
    const stride = this.movement * (0.46 + run * 0.27) * (1 - c * 0.45);
    const swing = Math.sin(this.phase),
      opposite = -swing;
    const breathing = Math.sin(this.elapsed * 1.9) * 0.003;
    this.pelvisPosition.set(
      0,
      this.baseHeight -
        c * 0.125 +
        Math.cos(this.phase * 2) * this.movement * 0.017 +
        breathing,
      0,
    );
    this.bones.get("pelvis")!.setPosition(this.pelvisPosition);
    this.rotate("pelvis", 0, swing * this.movement * 0.032);
    this.rotate("spine", c * 0.2 + run * 0.09, opposite * this.movement * 0.04);
    this.rotate(
      "chest",
      run * 0.055 - c * 0.035,
      swing * this.movement * 0.035,
    );
    this.rotate(
      "neck",
      -0.025 - c * 0.05,
      Math.sin(this.elapsed * 0.51) * 0.025 * (1 - this.movement),
    );
    this.rotate(
      "head",
      -run * 0.04,
      Math.sin(this.elapsed * 0.47) * 0.035 * (1 - this.movement),
    );
    for (const [side, wave] of [
      [-1, swing],
      [1, opposite],
    ] as const) {
      const left = side < 0;
      const thigh: Joint = left ? "leftThigh" : "rightThigh",
        calf: Joint = left ? "leftCalf" : "rightCalf",
        foot: Joint = left ? "leftFoot" : "rightFoot";
      const arm: Joint = left ? "leftArm" : "rightArm",
        forearm: Joint = left ? "leftForearm" : "rightForearm",
        hand: Joint = left ? "leftHand" : "rightHand";
      const knee = Math.max(0, -wave) * this.movement * (0.62 + run * 0.62);
      this.rotate(thigh, -wave * stride - c * 0.47, 0, side * c * 0.035);
      this.rotate(calf, knee + c * 0.93);
      this.rotate(foot, -knee * 0.43 + c * -0.42 + wave * stride * 0.24);
      this.rotate(
        arm,
        (wave * stride * 0.74 - 0.055) * (1 - a) - a * (left ? 1.18 : 1.38),
        a * side * 0.14,
        side * (0.045 + a * -0.12),
      );
      this.rotate(forearm, -0.11 - run * 0.63 - a * (left ? 0.44 : 0.18), 0, 0);
      this.rotate(hand, -a * 0.08, 0, -side * a * 0.09);
    }
    this.root.scaling.y = 1 - c * 0.19;
  }

  /** Authored overlays on the same skin rig; call after locomotion animation. */
  pose(kind: "seated" | "mount" | "climb" | "swim" | "hit", phase = 1, seating: "low" | "upright" | "rider" = "upright"): void {
    const seated = kind === "seated" || kind === "mount";
    const amount = kind === "mount" ? Math.max(0, Math.min(1, phase)) : 1;
    if (seated) {
      const rider = seating === "rider", thigh = rider ? -0.85 : -1.6, calf = rider ? 1.95 : seating === "low" ? 0.25 : 1.15;
      this.rotate("leftThigh", thigh * amount, 0, rider ? -0.32 * amount : 0);
      this.rotate("rightThigh", thigh * amount, 0, rider ? 0.32 * amount : 0);
      this.rotate("leftCalf", calf * amount);
      this.rotate("rightCalf", calf * amount);
      this.rotate("leftFoot", -(thigh + calf) * amount);
      this.rotate("rightFoot", -(thigh + calf) * amount);
      this.rotate("leftArm", (rider ? -1.1 : -1.35) * amount);
      this.rotate("rightArm", (rider ? -1.1 : -1.35) * amount);
      this.rotate("leftForearm", (rider ? -0.3 : -0.1) * amount);
      this.rotate("rightForearm", (rider ? -0.3 : -0.1) * amount);
      this.rotate("spine", 0.1 * amount);
    } else if (kind === "climb") {
      this.rotate("leftArm", -2.65);
      this.rotate("rightArm", -2.65);
      this.rotate("leftForearm", -0.2);
      this.rotate("rightForearm", -0.2);
      this.rotate("leftThigh", -1.0);
      this.rotate("leftCalf", 1.1);
      this.rotate("spine", 0.22);
    } else if (kind === "swim") {
      this.rotate("spine", 0.52);
      this.rotate("leftArm", -1.7 + Math.sin(phase) * 0.8, -0.5);
      this.rotate("rightArm", -1.7 - Math.sin(phase) * 0.8, 0.5);
      this.rotate("leftThigh", Math.sin(phase * 1.4) * 0.32);
      this.rotate("rightThigh", -Math.sin(phase * 1.4) * 0.32);
    } else {
      this.rotate("chest", -0.24 * Math.sin(phase * Math.PI));
    }
  }

  position(p: Vector3): void {
    this.root.position.copyFrom(p);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.dispose(false, false);
    this.skeleton.dispose();
    this.material.users--;
    if (this.material.users === 0) {
      this.material.material.dispose();
      characterMaterials.delete(this.scene);
    }
  }
}
