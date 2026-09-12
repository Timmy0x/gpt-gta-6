import {
  CharacterSupportedState,
  Color3,
  DynamicTexture,
  MeshBuilder,
  Matrix,
  Quaternion,
  PBRMaterial,
  PhysicsCharacterController,
  Vector3,
  type Mesh,
  type PhysicsEngineV2,
  type Scene,
  type ShadowGenerator,
} from "@babylonjs/core";
import { Character } from "../Character";
import { blockedCrawlEffects, bodyInjuryEffects } from '../Injuries';
import { CrawlingCollider } from '../CrawlingCollider';
import { MovementQueries } from '../MovementQueries';
export type OfficerRole = "patrol" | "swat" | "military";
export type OfficerState =
  | "riding"
  | "pursuit"
  | "search"
  | "challenge"
  | "firing"
  | "injured";
/** A real skinned actor. Foot collision is owned by Babylon's Havok character controller. */
export class Officer {
  model: Character;
  controller: PhysicsCharacterController | null = null;
  health: number;
  state: OfficerState = "riding";
  path: { x: number; z: number }[] = [];
  routeTimer = 0;
  fireTimer = 1.1;
  flashTime = 0;
  deadTime = 0;
  private materials: PBRMaterial[] = [];
  private textures: DynamicTexture[] = [];
  private crawl: CrawlingCollider;
  private queries: MovementQueries;
  weapon: Mesh;
  flash: Mesh;
  constructor(
    public id: string,
    public role: OfficerRole,
    public vehicleId: string,
    private scene: Scene,
    shadows: ShadowGenerator,
    public seat = 0,
  ) {
    this.crawl = new CrawlingCollider(scene);
    this.queries = new MovementQueries(scene, () => this.crawl.queryExclusions(this.controller));
    this.health = role === "military" ? 140 : role === "swat" ? 150 : 100;
    this.model = new Character(
      scene,
      shadows,
      id,
      role === "military" ? "#6c7051" : role === "swat" ? "#162827" : "#182e48",
      false,
      role === "military" ? "#535E42" : role === "swat" ? "#162827" : "#182E48",
    );
    const material = (name: string, color: string) => {
      const m = new PBRMaterial(`${id}/${name}`, scene);
      m.albedoColor = Color3.FromHexString(color);
      m.roughness = 0.8;
      this.materials.push(m);
      return m;
    };
    const armor = material(
        "uniform-equipment",
        role === "military" ? "#414b35" : role === "swat" ? "#15201e" : "#16273a",
      ),
      badge = material("badge", "#e8c272");
    const box = (
      name: string,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      mat = armor,
    ) => {
      const mesh = MeshBuilder.CreateBox(
        `${id}/${name}`,
        { width: w, height: h, depth: d },
        scene,
      );
      mesh.parent = this.model.root;
      mesh.position.set(x, y, z);
      mesh.material = mat;
      mesh.metadata = { officer: this };
      this.model.parts.push(mesh);
      shadows.addShadowCaster(mesh);
      return mesh;
    };
    const attachEquipment = (mesh: Mesh, joint: string) => {
      const bone = this.model.skeleton.bones.find(b => b.name.endsWith('/' + joint))!;
      this.model.skeleton.computeAbsoluteMatrices(true);
      this.model.skeleton.prepare(true);
      const world = mesh.computeWorldMatrix(true).clone();
      const parentWorld = bone.getFinalMatrix().multiply(this.model.torso.computeWorldMatrix(true));
      const local = world.multiply(Matrix.Invert(parentWorld));
      mesh.attachToBone(bone, this.model.torso);
      mesh.rotationQuaternion = Quaternion.Identity();
      local.decompose(mesh.scaling, mesh.rotationQuaternion, mesh.position);
    };
    box("duty-belt", 0.35, 0.07, 0.27, 0, 1.02, 0);
    box("radio", 0.07, 0.12, 0.06, -0.17, 1.32, 0.14);
    box("badge", 0.055, 0.072, 0.013, 0.092, 1.4, 0.146, badge);
    box("shoulder-patch", 0.02, 0.09, 0.085, 0.239, 1.39, 0, badge);
    if (role !== "patrol") box("ballistic-vest", 0.4, 0.37, 0.3, 0, 1.27, 0);
    if(role === "military") {
      box("reserve-armband",.022,.12,.14,-.24,1.36,0,badge);
      box("field-pack",.27,.27,.12,0,1.24,-.2);
    }
    const helmet = MeshBuilder.CreateSphere(
      `${id}/headwear`,
      { diameterX: 0.32, diameterY: 0.18, diameterZ: 0.31, segments: 10 },
      scene,
    );
    helmet.parent = this.model.root;
    helmet.position.y = 1.78;
    helmet.material = armor;
    helmet.metadata = { officer: this };
    this.model.parts.push(helmet);
    if (typeof document !== "undefined") {
      const texture = new DynamicTexture(
        `${id}/uniform-label`,
        { width: 256, height: 64 },
        scene,
        false,
      );
      texture.drawText(
        role === "military" ? "MILITARY" : role === "swat" ? "SWAT" : "POLICE",
        null,
        49,
        role === "military" ? "bold 36px sans-serif" : "bold 48px sans-serif",
        "#f2f1df",
        "#172b38",
        true,
      );
      const label = material("uniform-label", "#ffffff");
      label.albedoTexture = texture;
      this.textures.push(texture);
      box("marked-back", 0.31, 0.08, 0.008, 0, 1.41, -0.156, label);
      box("marked-front", 0.23, 0.063, 0.008, 0, 1.28, 0.157, label);
    }
    for (const mesh of this.model.parts) {
      const name = mesh.name.slice(id.length + 1);
      const joint = name === 'duty-belt' ? 'pelvis' : name === 'headwear' ? 'head'
        : name === 'shoulder-patch' ? 'rightArm' : name === 'reserve-armband' ? 'leftArm'
        : ['radio', 'badge', 'ballistic-vest', 'field-pack', 'marked-back', 'marked-front'].includes(name) ? 'chest' : null;
      if (joint) attachEquipment(mesh, joint);
    }
    shadows.addShadowCaster(helmet);
    this.weapon = box(
      role !== "patrol" ? "carbine" : "sidearm",
      0.055,
      0.095,
      role !== "patrol" ? 0.48 : 0.23,
      0.18,
      1.42,
      0.45,
    );
    this.flash = box(
      "muzzle-flash",
      0.065,
      0.065,
      0.085,
      0.18,
      1.42,
      role !== "patrol" ? 0.72 : 0.6,
      badge,
    );
    this.flash.setEnabled(false);
    // Gear must follow the skinned hand, including aim and hit poses.
    const hand=this.model.skeleton.bones.find(b=>b.name.endsWith("/rightHand"));
    if(hand){
      this.weapon.attachToBone(hand,this.model.torso);
      this.weapon.position.set(0,-.02,role!=="patrol"?.15:.075);
      this.weapon.rotation.set(Math.PI/2,0,0);
      this.flash.parent=this.weapon;this.flash.position.set(0,0,role!=="patrol"?.29:.17);
    }
    this.weapon.setEnabled(false);
    this.model.parts.forEach(
      (m) => (m.metadata = { ...m.metadata, officer: this }),
    );
  }
  get position() {
    return this.controller
      ? this.controller.getPosition()
      : this.model.root.position.add(new Vector3(0, 0.9, 0));
  }
  dismount(position: Vector3) {
    this.controller?.dispose();
    const physics = this.scene.getPhysicsEngine() as PhysicsEngineV2;
    const existingBodies = new Set(physics.getBodies());
    this.controller = new PhysicsCharacterController(
      position,
      { capsuleHeight: 1.8, capsuleRadius: 0.34 },
      this.scene,
    );
    for (const body of physics.getBodies())
      if (!existingBodies.has(body))
        body.transformNode.metadata = {
          ...body.transformNode.metadata,
          officer: this,
        };
    this.controller.maxStepHeight = 0.38;
    this.controller.characterMass = 85;
    this.controller.characterStrength = 1000;
    this.model.root.position.copyFrom(position).y -= 0.9;
    this.state = "pursuit";
  }
  move(dt: number, direction: Vector3, speed: number, aim: boolean) {
    if (!this.controller) return;
    if (this.model.root.metadata?.ragdollHandoffActive) speed = 0;
    else if (direction.lengthSquared() > .001) {
      const yaw = this.model.root.rotation.y, desired = Math.atan2(direction.x, direction.z);
      const delta = Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw));
      this.model.root.rotation.y += Math.max(-dt * 4, Math.min(dt * 4, delta));
    }
    let injuries = bodyInjuryEffects(this.model.bodyInjuries);
    if (injuries.mode === 'crawling' || injuries.mode === 'down') this.crawl.apply(this.controller, this.model.root.rotation.y);
    else if (this.controller.shape === this.crawl.shape) {
      const standing = this.controller.getPosition().add(new Vector3(0, .9 - this.controller.footOffset, 0));
      if (this.queries.clear(standing)) { this.controller.setShapeOptions({capsuleHeight: 1.8, capsuleRadius: .34}); this.controller.maxStepHeight = .38; }
      else { if (this.model.bodyInjuries) this.model.bodyInjuries.riseRemaining = 3; injuries = blockedCrawlEffects(injuries); }
    }
    speed = Math.min((injuries.canSprint ? speed : Math.min(speed, 1.35)) * injuries.speedScale, injuries.maxSpeed);
    aim &&= injuries.canAim;
    const support = this.controller.checkSupport(dt, new Vector3(0, -1, 0));
    const previous = this.controller.getVelocity();
    const grounded =
      support.supportedState === CharacterSupportedState.SUPPORTED;
    const crawling = injuries.mode === 'crawling' || injuries.mode === 'down';
    const travel = crawling ? this.model.root.forward.scale(speed * Math.max(0, Vector3.Dot(direction, this.model.root.forward))) : direction.scale(speed);
    const start = this.controller.getPosition().clone();
    this.controller.setVelocity(
      new Vector3(
        travel.x,
        grounded ? Math.max(0, previous.y) : previous.y - 9.81 * dt,
        travel.z,
      ),
    );
    this.controller.integrate(dt, support, new Vector3(0, -9.81, 0));
    this.model.root.position.copyFrom(this.controller.getPosition()).y -= this.controller.footOffset;
    const actualSpeed = Math.hypot(this.controller.getPosition().x - start.x, this.controller.getPosition().z - start.z) / Math.max(.001, dt);
    this.model.animate(dt, actualSpeed, aim, false);
    this.model.applyInjuryPose(injuries, dt, actualSpeed);
    this.model.skeleton.computeAbsoluteMatrices(true);
    this.model.skeleton.prepare(true);
    this.weapon.setEnabled(aim);
  }
  dispose() {
    this.controller?.dispose();
    this.controller = null;
    this.queries.dispose(); this.crawl.dispose();
    this.weapon.dispose();
    this.model.dispose();
    this.textures.forEach((t) => t.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
