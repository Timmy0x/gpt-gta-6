import "./ui/style.css";
import {
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  HemisphericLight,
  HavokPlugin,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  Scene,
  ShadowGenerator,
  Vector3,
  PhysicsEngineV2,
} from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import havokWasm from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import { createRenderer } from "./core/Renderer";
import { prepareEnvironmentLighting } from "./core/EnvironmentLighting";
import { Sky } from "./core/Sky";
import { Input, type Action } from "./core/Input";
import { Persistence } from "./core/Persistence";
import { GameAudio } from "./core/Audio";
import { distance } from "./core/math";
import { World } from "./world/World";
import { VehicleSystem, type Vehicle, VEHICLE_TUNING } from "./vehicles";
import type { VehicleKind } from "./core/contracts";
import { AIRCRAFT_SPAWNS, aircraftInput, aircraftPrompt, isAircraft } from "./vehicles/aircraft";
import { findGroundVehicleSpawn } from "./vehicles/spawnPlacement";
import { Player } from "./gameplay/Player";
import { prepareCharacterAssets, prepareCivilianAssets } from "./gameplay/characters/RocketboxSkin";
import { DETAILED_CAR_LIMIT } from "./vehicles/ConceptCar";
import { WantedSystem } from "./gameplay/Wanted";
import { Population } from "./gameplay/Population";
import { DamageSystem } from "./gameplay/Damage";
import { Combat } from "./gameplay/Combat";
import { UI } from "./ui/UI";
import { Navigation } from "./gameplay/Navigation";
import { PhysicsInterpolation } from "./core/PhysicsInterpolation";
import { Atmosphere } from "./core/Atmosphere";
import { FrameHistory } from "./core/FrameHistory";
import { nearbyGarage, serviceAtGarage } from "./gameplay/Garage";
const ui = new UI();
async function boot() {
  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  ui.loading("Selecting a rendering backend…");
  const { engine, backend, fallbackReason } = await createRenderer(canvas);
  const scene = new Scene(engine);
  const sky = new Sky(scene);
  scene.onDisposeObservable.addOnce(() => sky.dispose());
  Scene.MaxDeltaTime = (1000 / 60) * 5;
  scene.clearColor = new Color4(0.55, 0.76, 0.81, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0013;
  scene.fogColor = new Color3(0.58, 0.74, 0.76);
  ui.loading("Loading Havok physics…");
  const havok = await HavokPhysics({ locateFile: () => havokWasm });
  const plugin = new HavokPlugin(false, havok);
  scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  physics.setTimeStep(1 / 60);
  physics.setSubTimeStep(1000 / 60);
  physics.setVelocityLimits(100, 25);
  const ambient = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.85;
  ambient.groundColor = new Color3(0.34, 0.32, 0.29);
  const sun = new DirectionalLight("sun", new Vector3(-0.6, -0.8, 0.35), scene);
  sun.position.set(150, 240, -110);
  sun.shadowFrustumSize = 200;
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 360;
  sun.intensity = 2.5;
  sun.diffuse = new Color3(1, 0.83, 0.64);
  const shadows = new ShadowGenerator(2048, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
  shadows.bias = 0.002;
  shadows.normalBias = 0.025;
  shadows.darkness = 0.18;
  ui.loading("Loading the coast and nearby streets…");
  await new Promise((r) => setTimeout(r, 20));
  ui.loading("Preparing coastal lighting…");
  await prepareEnvironmentLighting(scene);
  scene.environmentIntensity = 0.85;
  const ctx = { scene, shadows };
  const world = new World(ctx);
  await world.ready;
  const navigation = new Navigation(world.roads);
  ui.world = world;
  ui.loading("Loading character detail…");
  try { await prepareCharacterAssets(scene); }
  catch (error) { console.warn("Using the procedural character fallback", error); }
  ui.loading("Loading street characters…");
  try { await prepareCivilianAssets(scene); }
  catch (error) { console.warn("Using the procedural civilian fallback", error); }
  const input = new Input(canvas);
  const player = new Player(scene, shadows, input, world.spawn);
  const vehicles = new VehicleSystem(ctx);
  const interpolation = new PhysicsInterpolation();
  vehicles.waterLevel = world.waterLevel;
  ui.loading("Preparing the starter car…");
  try { await vehicles.prepareModel("concept"); }
  catch (error) { console.warn("Using the starter coupe fallback", error); }
  const startCar = vehicles.spawn(vehicles.concept.ready ? "concept" : "coupe", new Vector3(3, 1, -23), 0);
  vehicles.spawn("motorcycle", new Vector3(11, 1, -42), Math.PI);
  vehicles.spawn("boat", new Vector3(239, 0.4, -230), 0);
  const wanted = new WantedSystem();
  const population = new Population(
    scene,
    shadows,
    world,
    vehicles,
    player,
    wanted,
  );
  const damage = new DamageSystem(scene, shadows, world);
  const combat = new Combat(
    scene,
    player,
    population,
    damage,
    vehicles,
    wanted,
  );
  const audio = new GameAudio();
  const atmosphere = new Atmosphere(scene, world.lightPositions);
  const pipeline = new DefaultRenderingPipeline("cinematic", true, scene, [
    player.camera,
  ]);
  pipeline.fxaaEnabled = true;
  pipeline.samples = 1;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.exposure = 1.12;
  pipeline.imageProcessing.contrast = 1.1;
  pipeline.bloomEnabled = false;
  let time = 15.8,
    weather = "Clear",
    cash = 12500,
    paused = true,
    simSpeed = 1,
    quality = "high",
    started = false,
    simTime = 0,
    frame = 0,
    lastFrame = performance.now(),
    hudTime = 0,
    activity = "",
    raceIndex = -1,
    raceTime = 0,
    stats = false;
  let recoveryTimer = 0,
    closest: Vehicle | null = null,
    crashCount = 0;
  let loadingWorld = false;
  async function prepareVehicleModels(kinds: VehicleKind[]): Promise<boolean> {
    if (!kinds.includes("concept") || vehicles.concept.ready) return true;
    if (loadingWorld) return false;
    loadingWorld = true;
    const previousPause = paused;
    setPause(true);
    ui.toast("Loading Aster Concept…", true);
    try { await vehicles.prepareModel("concept"); ui.toast(""); return true; }
    catch (error) { console.error("Vehicle loading failed", error); ui.toast("This vehicle could not load. Check your connection and try again."); return false; }
    finally { loadingWorld = false; setPause(previousPause); }
  }
  async function prepareTravel(destination: Vector3): Promise<boolean> {
    if (loadingWorld) return false;
    loadingWorld = true;
    const previousPause = paused, origin = player.position.clone();
    input.clear();
    setPause(true);
    ui.toast("Loading nearby streets…", true);
    try { await world.preparePosition(destination); ui.toast(""); return true; }
    catch (error) {
      console.error("Destination loading failed", error);
      world.ensureCollision(origin);
      ui.toast("This area could not load. Check your connection and try again.");
      return false;
    } finally { loadingWorld = false; setPause(previousPause); }
  }
  const frameTimes = new FrameHistory();
  let raceMarker: Mesh | null = null;
  const racePoints = [
    new Vector3(0, 2, 65),
    new Vector3(72, 2, 144),
    new Vector3(144, 2, 72),
    new Vector3(72, 2, 0),
    new Vector3(0, 2, -72),
  ];
  function resetPlayer(reason: string) {
    combat.reactions.reset({ preserveFatal: true });
    player.exit(true);
    player.health = 100;
    player.armor = 50;
    player.deadTimer = 0;
    player.teleport(world.spawn.clone());
    population.reset(false);
    cash = Math.max(0, cash - (reason === "BUSTED" ? 300 : 100));
    ui.outcome("");
    activity = "Back on the coast. Find your next ride.";
    recoveryTimer = 0;
  }
  population.onArrest = () => {
    if (recoveryTimer > 0) return;
    ui.outcome("BUSTED");
    recoveryTimer = 3;
    input.clear();
  };
  population.onMessage = (message) => ui.toast(message);
  damage.onBreak = (p) => {
    audio.effect("impact", p);
  };
  combat.onSound = (kind, p) => audio.effect(kind, p);
  combat.onMessage = (s) => ui.toast(s);
  vehicles.onCrash = (v, severity, p) => {
    crashCount++;
    audio.effect("impact", p);
    if (v === player.vehicle && severity > 4) {
      player.hurt(Math.max(0, severity - 8) * 1.2);
      wanted.crime(severity > 10 ? 65 : 20, p, population.witness(p));
      population.frighten(p);
      ui.toast(
        `Impact · ${Math.round(v.health)}% vehicle condition${v.health < 45 ? " · mechanical damage" : ""}`,
      );
    }
  };
  function setPause(value: boolean) {
    paused = value;
    scene.physicsEnabled = !paused;
    if (paused) {
      input.clear();
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }
  function nearestVehicle() {
    let best: Vehicle | null = null,
      dist = 5;
    for (const v of vehicles.list) {
      const d = Vector3.Distance(v.root.position, player.position);
      if (d < dist) {
        best = v;
        dist = d;
      }
    }
    return best;
  }
  function save() {
    try {
      Persistence.save({
        player: {
          x: player.position.x,
          y: player.position.y,
          z: player.position.z,
          character: player.name,
          health: player.health,
          armor: player.armor,
        },
        time,
        weather,
        cash,
        combat: {
          selected: combat.weapon,
          magazines: [...combat.inventory.magazines],
          reserves: [...combat.inventory.reserves],
        },
        vehicles: vehicles.list
          .filter((v) => !population.drivers.some((d) => d.v === v))
          .map((v) => vehicles.serialize(v)),
        destroyed: [...damage.destroyed],
        props: damage.serialize(),
        casualties: population.serializeCasualties(),
        civilians: population.pedestrians
          .filter((p) => p.creative)
          .map((p) => ({
            id: p.id,
            x: p.model.root.position.x,
            y: p.model.root.position.y,
            z: p.model.root.position.z,
            health: p.health,
          })),
        settings: {
          god: player.god,
          noclip: player.noclip,
          ammo: combat.unlimited,
          peds: population.density,
          traffic: population.trafficDensity,
          quality,
          police: population.policeEnabled,
          "sim-speed": simSpeed,
          sound: audio.enabled,
          stats,
        },
      });
      ui.toast("Sandbox saved on this browser.");
    } catch (e) {
      ui.toast("Save failed: browser storage is unavailable or full.");
      console.error(e);
    }
  }
  async function load() {
    const s = Persistence.load();
    if (!s) {
      ui.toast("No compatible saved sandbox in this browser.");
      return false;
    }
    if (s.vehicles.filter(v => v.kind === "concept").length > DETAILED_CAR_LIMIT) { ui.toast("Saved sandbox exceeds the six detailed-car limit."); return false; }
    if (!await prepareVehicleModels(s.vehicles.map(v => v.kind as VehicleKind))) return false;
    if (!await prepareTravel(new Vector3(s.player.x, s.player.y, s.player.z))) return false;
    combat.reactions.reset();
    player.exit(true);
    for (const v of [...vehicles.list])
      if (!population.drivers.some((d) => d.v === v)) vehicles.remove(v);
    const savedIds = new Set(s.vehicles.map((v) => v.id).filter(Boolean));
    population.drivers = population.drivers.filter(
      (d) => !savedIds.has(d.v.id),
    );
    // Saved owned cars take priority over disposable ambient traffic within the same visual budget.
    let detailedCount = s.vehicles.filter(v => v.kind === "concept").length;
    population.drivers = population.drivers.filter(d => {
      if (d.v.kind !== "concept") return true;
      if (++detailedCount <= DETAILED_CAR_LIMIT) return true;
      vehicles.remove(d.v);
      return false;
    });
    for (const v of s.vehicles) vehicles.restore(v);
    player.teleport(new Vector3(s.player.x, s.player.y + 1, s.player.z));
    if (s.player.character !== player.name) player.switchCharacter();
    player.health = s.player.health;
    player.deadTimer = 0;
    recoveryTimer = 0;
    ui.outcome("");
    player.armor = s.player.armor ?? 50;
    if (s.combat) {
      combat.inventory.magazines = [...s.combat.magazines];
      combat.inventory.reserves = [...s.combat.reserves];
      combat.weapon = s.combat.selected;
      combat.reloadTime = 0;
    }
    time = s.time;
    weather = s.weather;
    cash = s.cash;
    player.god = !!s.settings.god;
    player.noclip = !!s.settings.noclip;
    combat.unlimited = !!s.settings.ammo;
    population.density = Number(s.settings.peds ?? 1);
    population.trafficDensity = Number(s.settings.traffic ?? 1);
    population.policeEnabled =
      s.settings.police === undefined ? true : !!s.settings.police;
    if ([0.25, 0.5, 1, 2].includes(Number(s.settings["sim-speed"])))
      ui.onAction("sim-speed", String(s.settings["sim-speed"]));
    if (s.settings.sound !== undefined)
      ui.onAction("sound", String(s.settings.sound));
    if (s.settings.stats !== undefined)
      ui.onAction("stats", String(s.settings.stats));
    if (["high", "medium", "low"].includes(String(s.settings.quality)))
      ui.onAction("quality", String(s.settings.quality));
    if (s.props) damage.restoreState(s.props);
    else damage.restore(s.destroyed);
    for (const p of population.pedestrians.filter((p) => p.creative))
      p.model.dispose();
    population.pedestrians = population.pedestrians.filter((p) => !p.creative);
    population.reset();
    for (const p of s.civilians || []) {
      const ped = population.spawnPed(
        new Vector3(p.x, p.y, p.z),
        undefined,
        true,
        p.id,
      );
      ped.health = p.health;
    }
    if (s.casualties) population.restoreCasualties(s.casualties);
    ui.toast("Saved sandbox restored.");
    return true;
  }
  function beginRace() {
    if (!player.vehicle) {
      ui.toast("Enter a vehicle to start the coastal sprint.");
      return;
    }
    raceIndex = 0;
    raceTime = 0;
    raceMarker?.dispose(false, true);
    raceMarker = MeshBuilder.CreateTorus(
      "race checkpoint",
      { diameter: 10, thickness: 0.22, tessellation: 48 },
      scene,
    );
    const mat = new PBRMaterial("checkpoint", scene);
    mat.albedoColor = new Color3(0.5, 1, 0.8);
    mat.emissiveColor = new Color3(0.25, 0.85, 0.55);
    raceMarker.material = mat;
    raceMarker.rotation.x = Math.PI / 2;
    raceMarker.position.copyFrom(racePoints[0]);
    raceMarker.isPickable = false;
    ui.toast("Coastal sprint · Drive through the five green checkpoints.");
  }
  function interact() {
    if (population.facility.canRequestAccess && population.facility.accessRemaining <= 0) {
      population.facility.requestAccess();
      return;
    }
    const service = nearbyGarage(player.position, world.locations);
    if (
      service &&
      player.vehicle &&
      Math.abs(player.vehicle.speed) < 2
    ) {
      ui.showPanel("garage");
      setPause(true); input.clear();
      if (document.pointerLockElement) document.exitPointerLock();
      return;
    }
    if (player.vehicle) {
      if (player.vehicle.speed > 10) {
        ui.toast("Slow down before exiting.");
        return;
      }
      if (!player.exit()) ui.toast(player.interactionMessage);
      return;
    }
    const v = nearestVehicle();
    if (v) {
      if (!player.enter(v)) {
        ui.toast(player.interactionMessage);
        return;
      }
      audio.start();
      ui.toast(
        isAircraft(v.kind) ? `${v.tuning.label} · ${aircraftPrompt(v, input)}` : `${v.tuning.label} · W/S throttle · A/D steer · Space handbrake · E exit`,
      );
      return;
    }
    const loc = world.locations.find((l) => distance(l, player.position) < 12);
    if (loc) {
      if (
        loc.type.includes("garage") ||
        loc.name.toLowerCase().includes("garage")
      ) {
        ui.toast("Drive a vehicle to the entrance for repair and paint service.");
      } else if (
        loc.type.includes("race") ||
        loc.name.toLowerCase().includes("sprint")
      )
        beginRace();
      else if (/shop|supply|store/i.test(loc.type + " " + loc.name)) {
        if (cash < 50) {
          ui.toast("Supplies cost $50.");
          return;
        }
        player.health = 100;
        combat.inventory.reserves = [180, 180, 6];
        cash = Math.max(0, cash - 50);
        ui.toast(`${loc.name} · Supplies purchased for $50.`);
      }
    }
  }
  ui.onAction = async (action, value) => {
    if (loadingWorld) return;
    if (action === "garage-repair" || action === "garage-paint") {
      const result = serviceAtGarage(vehicles, player.vehicle, world.locations, cash, action === "garage-repair" ? "repair" : "paint", document.querySelector<HTMLSelectElement>("#paint-color")?.value);
      cash = result.cash; ui.toast(result.message); return;
    }
    if (action === "garage-exit") {
      if (player.exit()) { ui.showPanel(""); setPause(false); }
      else ui.toast(player.interactionMessage);
      return;
    }
    if (action === "vehicle-lights" || action === "vehicle-siren") {
      const v = player.vehicle || nearestVehicle();
      if (!v) { ui.toast("Approach or enter a vehicle first."); return; }
      if (action === "vehicle-lights") { v.headlights = !v.headlights; ui.toast(`Headlights ${v.headlights ? "on" : "off"}.`); }
      else if (v.kind === "police") { v.siren = !v.siren; ui.toast(`Siren ${v.siren ? "on" : "off"}.`); }
      else ui.toast("This vehicle has no siren.");
      return;
    }
    if (action === "route" && value) {
      const location = world.locations.find((l) => l.id === value);
      if (location) {
        navigation.set(location, player.position);
        ui.toast(`Route set · ${location.name}`);
        ui.showPanel("");
        setPause(false);
      }
      return;
    }
    if (action === "clear-route") {
      navigation.clear();
      ui.toast("Route cleared.");
      return;
    }
    if (action === "play" || action === "continue") {
      audio.start();
      if (action === "continue" && !await load()) return;
      started = true;
      ui.start();
      ui.showPanel("");
      setPause(false);
      canvas.focus();
      ui.toast(action === "continue" ? "Saved sandbox restored." : "E  Drive");
      return;
    }
    if (["creative", "map", "pause", "credits"].includes(action)) {
      const panel = ui.panel === action ? "" : action;
      ui.showPanel(panel);
      setPause(panel === "pause" || panel === "map" || panel === "credits");
      input.clear();
      if (panel && player.vehicle)
        vehicles.control(player.vehicle, {
          throttle: 0,
          steer: 0,
          brake: 1,
          handbrake: false,
          lift: 0,
        });
      if (document.pointerLockElement) document.exitPointerLock();
      return;
    }
    if (action === "close") {
      input.clear();
      ui.showPanel("");
      setPause(false);
      canvas.focus();
      return;
    }
    if (action === "spawn") {
      if (vehicles.list.length >= 56) {
        ui.toast("Vehicle budget reached. Remove a vehicle first.");
        return;
      }
      const kind = (document.querySelector<HTMLSelectElement>("#spawn-kind")
        ?.value || "coupe") as VehicleKind;
      if (kind === "concept" && vehicles.list.filter(v => v.kind === "concept").length >= DETAILED_CAR_LIMIT) { ui.toast("Six detailed cars are already nearby. Remove one first."); return; }
      if (!await prepareVehicleModels([kind])) return;
      let p = player.position.clone();
      if (!isAircraft(kind) && kind !== "boat") {
        const clear = findGroundVehicleSpawn({scene, kind, origin:player.position, heading:player.yaw, obstacles:world.obstacles, vehicles:vehicles.list});
        if (!clear) { ui.toast("No clear space for this vehicle nearby. Move to a wider open area and try again."); return; }
        p = clear;
      }
      if (kind === "boat") p = new Vector3(239, 0.4, -230);
      if (kind === "plane" || kind === "helicopter") {
        const launch = AIRCRAFT_SPAWNS[kind];
        p = new Vector3(launch.x, launch.y, launch.z);
      }
      if (isAircraft(kind) && vehicles.list.some(v => Math.abs(v.root.position.x - p.x) < 10 && Math.abs(v.root.position.z - p.z) < 12 && Math.abs(v.root.position.y - p.y) < 6)) {
        ui.toast("Aircraft launch area occupied. Move or remove the aircraft there before spawning another.");
        return;
      }
      if (["boat", "plane", "helicopter"].includes(kind) && !await prepareTravel(p)) return;
      const v = vehicles.spawn(kind, p, isAircraft(kind) ? 0 : player.yaw);
      ui.toast(
        `${v.tuning.label} spawned${kind === "boat" ? " at the marina" : kind === "plane" || kind === "helicopter" ? ` at ${AIRCRAFT_SPAWNS[kind].label}` : ""}. ${isAircraft(kind) ? "Close the menu, then press E to enter." : ""}`,
      );
      if (["boat", "plane", "helicopter"].includes(kind)) {
        player.exit(true);
        player.teleport(p.add(new Vector3(3, 1, 0)));
        if (isAircraft(kind)) player.yaw = 0;
      }
      return;
    }
    if (action === "repair") {
      const v = player.vehicle || nearestVehicle();
      if (v) {
        vehicles.recover(v);
        ui.toast("Vehicle repaired and recovered.");
      }
      return;
    }
    if (action === "remove-vehicle") {
      const v = player.vehicle || nearestVehicle();
      if (v) {
        if (player.vehicle) player.exit(true);
        population.drivers = population.drivers.filter((d) => d.v !== v);
        vehicles.remove(v);
        ui.toast("Vehicle removed.");
      }
      return;
    }
    if (action === "prop") {
      if (damage.props.length >= 100) {
        ui.toast("Prop budget reached. Remove a prop first.");
        return;
      }
      const kind =
        document.querySelector<HTMLSelectElement>("#prop-kind")?.value ||
        "wood";
      const point = player.position.add(
        new Vector3(
          Math.sin(player.yaw) * 4,
          -player.position.y,
          Math.cos(player.yaw) * 4,
        ),
      );
      if (kind === "fence" || kind === "gate")
        damage.spawnBarrier(
          point,
          kind,
          kind === "gate" ? "metal" : "wood",
          player.yaw,
        );
      else
        damage.spawn(
          point.add(new Vector3(0, 0.55, 0)),
          kind as "wood" | "metal" | "glass",
        );
      ui.toast("Physical prop placed.");
    }
    if (action === "ignite" || action === "extinguish") {
      const prop = damage.props
        .filter(
          (p) =>
            (action === "extinguish" ? p.burning > 0 : p.health > 0) &&
            distance(p.mesh.position, player.position) < 12,
        )
        .sort(
          (a, b) =>
            distance(a.mesh.position, player.position) -
            distance(b.mesh.position, player.position),
        )[0];
      if (!prop) ui.toast("Place or approach a prop within 12 metres.");
      else {
        if (action === "ignite" && !damage.ignite(prop, 20)) {
          ui.toast("This material does not ignite.");
          return;
        }
        if (action === "extinguish") damage.extinguish(prop);
        ui.toast(
          action === "ignite"
            ? "Nearest prop ignited."
            : "Nearest prop extinguished.",
        );
      }
    }
    if (action === "ped") {
      if (population.pedestrians.length >= 60) {
        ui.toast("Civilian budget reached. Remove one first.");
        return;
      }
      population.spawnPed(player.position.add(new Vector3(3, -0.9, 2)));
      ui.toast("Civilian spawned.");
    }
    if (action === "remove-prop") {
      const prop = [...damage.props].sort(
        (a, b) =>
          distance(a.mesh.position, player.position) -
          distance(b.mesh.position, player.position),
      )[0];
      if (prop && distance(prop.mesh.position, player.position) < 12) {
        damage.remove(prop);
        ui.toast("Nearest prop removed.");
      } else ui.toast("No prop within 12 metres.");
    }
    if (action === "remove-ped") {
      const ped = population.pedestrians
        .filter((p) => p.health > 0)
        .sort(
          (a, b) =>
            distance(a.model.root.position, player.position) -
            distance(b.model.root.position, player.position),
        )[0];
      if (ped && distance(ped.model.root.position, player.position) < 15) {
        ped.model.dispose();
        population.pedestrians = population.pedestrians.filter(
          (p) => p !== ped,
        );
        ui.toast("Nearest civilian removed.");
      } else ui.toast("No civilian within 15 metres.");
    }
    if (action === "clear-weapons") {
      combat.inventory.magazines.fill(0);
      combat.inventory.reserves.fill(0);
      combat.reloadTime = 0;
      ui.toast("Weapons cleared.");
    }
    if (action === "weapons") {
      combat.inventory.reserves = [999, 999, 30];
      combat.inventory.magazines = combat.weapons.map((w) => w.capacity);
      ui.toast("Weapons refilled. Use 1, 2, 3 to select.");
    }
    if (action === "time") time = Number(value);
    if (action === "weather") {
      weather = value!;
      vehicles.wetness = weather === "Rain" ? 1 : 0;
    }
    if (action === "peds") population.density = Number(value);
    if (action === "traffic") population.trafficDensity = Number(value);
    if (action === "wanted") wanted.setLevel(Number(value), player.position);
    if (action === "god") player.god = value === "true";
    if (action === "ammo") combat.unlimited = value === "true";
    if (action === "noclip") player.noclip = value === "true";
    if (action === "police") population.policeEnabled = value === "true";
    if (action === "sim-speed") {
      simSpeed = Number(value);
      physics.setSubTimeStep(1000 / 60 / simSpeed);
    }
    if (action === "save") save();
    if (action === "load") await load();
    if (action === "reset") {
      combat.reactions.reset();
      population.reset();
      player.health = 100;
      player.armor = 50;
      ui.toast("Encounter reset.");
    }
    if (action === "teleport") {
      const l = world.locations.find((l) => l.id === value);
      if (l) {
        if (!await prepareTravel(new Vector3(l.x, 1.5, l.z))) return;
        player.exit(true);
        player.teleport(new Vector3(l.x, 1.5, l.z));
        ui.showPanel("");
        setPause(false);
        ui.toast(l.name);
      }
    }
    if (action === "quality") {
      quality = value!;
      engine.setHardwareScalingLevel(
        quality === "low" ? 1.7 : quality === "medium" ? 1.3 : 1,
      );
      shadows.getShadowMap()?.resize(quality === "high" ? 2048 : 1024);
    }
    if (action === "sound") audio.enabled = value === "true";
    if (action === "stats") {
      stats = value === "true";
      document
        .querySelector("#performance")!
        .classList.toggle("visible", stats);
    }
    if (action === "bind-key" && value) {
      const selected = (document.querySelector<HTMLSelectElement>(
        "#binding-action",
      )?.value || "forward") as Action;
      ui.toast(
        input.rebind(selected, value)
          ? "Control binding saved."
          : "Use a valid key code. Escape, 1–3 and T are reserved.",
      );
    }
  };
  canvas.addEventListener("click", () => {
    if (started && !ui.panel && !document.pointerLockElement)
      void canvas.requestPointerLock();
  });
  scene.onBeforePhysicsObservable.add(() => {
    if (paused || !started) return;
    const dt = 1 / 60;
    interpolation.beforeStep(vehicles.list.map((v) => v.root));
    simTime += dt;
    time = (time + dt / 160) % 24;
    if (recoveryTimer > 0) {
      recoveryTimer -= dt;
      if (recoveryTimer <= 0) resetPlayer("BUSTED");
    }
    if (player.deadTimer > 0) {
      player.deadTimer -= dt;
      ui.outcome("WASTED");
      if (player.deadTimer <= 0) resetPlayer("WASTED");
    }
    if (!ui.panel && recoveryTimer <= 0) {
      player.update(dt);
      if (player.vehicle && player.deadTimer <= 0)
        vehicles.control(player.vehicle, aircraftInput(input, player.vehicle.kind, player.vehicle.forwardSpeed));
      else if (player.vehicle)
        vehicles.control(player.vehicle, {
          throttle: 0,
          steer: 0,
          brake: 0.6,
          handbrake: false,
          lift: 0,
        });
    }
    combat.update(dt, !ui.panel && recoveryTimer <= 0);
    input.take("jump");
    population.update(dt);
    navigation.update(dt, player.position);
    vehicles.update(dt);
    damage.update(dt, weather);
    if (raceIndex >= 0 && player.vehicle) {
      raceTime += dt;
      activity = `COASTAL SPRINT   ${raceIndex + 1} / 5   ${raceTime.toFixed(1)}s`;
      if (distance(player.position, racePoints[raceIndex]) < 9) {
        raceIndex++;
        if (raceIndex >= racePoints.length) {
          cash += 750;
          activity = `Coastal sprint complete · ${raceTime.toFixed(1)}s · +$750`;
          raceIndex = -1;
          raceMarker?.dispose(false, true);
          raceMarker = null;
          ui.toast(activity);
        } else raceMarker?.position.copyFrom(racePoints[raceIndex]);
      }
    }
  });
  scene.onAfterPhysicsObservable.add(() => interpolation.afterStep());
  let renderDt = 1 / 60;
  scene.onBeforeRenderObservable.add(() => {
    // Babylon 9.25's pinned Physics V2 component owns this accumulator in milliseconds.
    const accumulator = (
      scene as unknown as { _physicsTimeAccumulator: number }
    )._physicsTimeAccumulator;
    const alpha = paused
      ? 1
      : Math.max(0, Math.min(1, accumulator / physics.getSubTimeStep()));
    interpolation.render(alpha);
    player.render(
      renderDt,
      alpha,
      !ui.panel && !paused && player.deadTimer <= 0,
    );
  });
  scene.onAfterRenderObservable.add(() => interpolation.restore());
  scene.physicsEnabled = false;
  ui.loading("Warming materials and shaders…");
  await scene.whenReadyAsync();
  let warmFrames = 0;
  const warmStarted = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now(),
      rawDt = (now - lastFrame) / 1000,
      dt = Math.min(rawDt, 0.1);
    lastFrame = now;
    renderDt = dt;
    frame++;
    input.poll();
    if (ui.pollGamepad(input.gamepad, dt)) input.clear();
    if (started) {
      if (input.pressed.has("Escape")) {
        input.pressed.delete("Escape");
        ui.onAction(ui.panel ? "close" : "pause");
      }
      if (input.take("creative")) ui.onAction("creative");
      if (input.take("map")) ui.onAction("map");
      if (!ui.panel && player.deadTimer <= 0 && recoveryTimer <= 0) {
        if (input.take("interact")) interact();
        if (input.take("switch")) player.switchCharacter();
        if (input.take("repair")) ui.onAction("repair");
        if (input.take("reload")) combat.reload();
        if (input.take("horn")) {
          if (player.vehicle) audio.effect("horn", player.position);
          else combat.melee();
        }
        if (input.take("lights") && player.vehicle) {
          player.vehicle.headlights = !player.vehicle.headlights;
          ui.toast(`Headlights ${player.vehicle.headlights ? "on" : "off"}.`);
        }
        if (input.take("siren") && player.vehicle?.kind === "police") {
          player.vehicle.siren = !player.vehicle.siren;
          ui.toast(`Siren ${player.vehicle.siren ? "on" : "off"}.`);
        }
        if (input.take("melee")) combat.melee();
        if (input.pressed.has("Digit1")) combat.select(0);
        if (input.pressed.has("Digit2")) combat.select(1);
        if (input.pressed.has("Digit3")) combat.select(2);
        if (input.pressed.has("KeyT")) beginRace();
      }
    }
    const solarState = sky.update(time, weather), solar = solarState.daylight;
    ambient.intensity = 0.04 + solar * 0.25;
    scene.environmentIntensity = 0.025 + Math.max(0, solar - 0.08) * 0.55;
    sun.intensity = solar * 2.6 * (weather === "Rain" ? 0.4 : 1);
    sun.direction.copyFrom(solarState.sunDirection).negateInPlace();
    sun.position.copyFrom(player.position.subtract(sun.direction.scale(150)));
    sun.diffuse = Color3.Lerp(
      new Color3(1, 0.6, 0.39),
      new Color3(1, 0.95, 0.84),
      solar,
    );
    scene.fogDensity =
      weather === "Rain" ? 0.003 : weather === "Haze" ? 0.004 : 0.00125;
    world.setActiveAnchors(
      vehicles.list
        .filter((v) => v.occupied || Math.abs(v.speed) > 0.4)
        .map((v) => v.root.position),
    );
    world.ensureCollision(player.position);
    world.update(paused ? 0 : dt, player.position, time, weather);
    atmosphere.update(paused ? 0 : dt, player.position, time, weather, paused);
    scene.fogColor.copyFrom(solarState.horizonColor);
    vehicles.wetness = atmosphere.wetness;
    audio.update(
      player.vehicle?.speed || 0,
      !!player.vehicle && !paused,
      paused ? 0 : wanted.stars,
      player.position,
      {
        dt,
        heading: player.yaw,
        weather,
        paused,
        footSpeed:
          ui.panel || player.vehicle || player.swimming || player.climbing
            ? 0
            : player.speed,
        sources: vehicles.list
          .filter((v) => (v !== player.vehicle || v.siren) && v.engineRunning)
          .map((v) => ({
            id: v.id,
            type: v.siren ? "siren" : "engine",
            position: v.root.position,
            speed: v.speed,
          })),
      },
    );
    scene.render();
    if (!ui.ready) {
      warmFrames = rawDt < 0.08 ? warmFrames + 1 : 0;
      if (warmFrames >= 8 || now - warmStarted > 20000) ui.loaded();
    }
    if (started && !paused) {
      frameTimes.push(rawDt * 1000);
    }
    hudTime += dt;
    if (hudTime > 0.09) {
      hudTime = 0;
      closest = nearestVehicle();
      let prompt = player.vehicle
        ? isAircraft(player.vehicle.kind) ? aircraftPrompt(player.vehicle, input) : "E  Exit"
        : closest
          ? "E  Drive"
          : "";
      if (!prompt) {
        const l = world.locations.find(
          (l) => distance(l, player.position) < 12,
        );
        if (l) prompt = "E  Use";
      }
      if (population.facility.canRequestAccess && population.facility.accessRemaining <= 0)
        prompt = "E  Access";
      if (player.vehicle && Math.abs(player.vehicle.speed) < 2 && nearbyGarage(player.position, world.locations))
        prompt = "E  Garage";
      ui.settings = {
        time,
        weather,
        peds: population.density,
        traffic: population.trafficDensity,
        "sim-speed": simSpeed,
        wanted: wanted.stars,
        police: population.policeEnabled,
        god: player.god,
        ammo: combat.unlimited,
        noclip: player.noclip,
        quality,
        sound: audio.enabled,
        stats,
      };
      ui.update({
        name: player.name,
        health: player.health,
        armor: player.armor,
        cash,
        stars: wanted.stars,
        phase: wanted.phase,
        timer: wanted.timer,
        speed: player.vehicle?.speed || 0,
        vehicle: player.vehicle?.tuning.label || "",
        weapon: combat.weapons[combat.weapon].name,
        ammo: combat.ammo,
        reserve: combat.reserve,
        reload: combat.reloadTime,
        time,
        weather,
        fps: engine.getFps(),
        backend,
        position: player.position,
        heading: player.yaw,
        prompt,
        activity,
        route: navigation.route,
        destination: navigation.destination
          ? `${navigation.destination.name} · ${Math.round(navigation.remaining)} m`
          : "",
        police: population.drivers
          .filter((d) => d.police)
          .map((d) => d.v.root.position),
        peds: population.pedestrians.map((p) => p.model.root.position),
        vehicles: vehicles.list.map((v) => v.root.position),
      });
    }
    input.endFrame();
  });
  window.addEventListener("resize", () => engine.resize());
  window.addEventListener("blur", () => {
    if (started && !paused) {
      ui.showPanel("pause");
      setPause(true);
    }
  });
  // Read-only instrumentation is always present; deterministic mutations are opt-in for test runs.
  const diagnostics = () => ({
    backend,
    cash,
    fallbackReason,
    position: player.position.asArray(),
    character: player.name,
    health: player.health,
    vehicle: player.vehicle
      ? {
          id: player.vehicle.id,
          kind: player.vehicle.kind,
          health: player.vehicle.health,
          speed: player.vehicle.speed,
          grounded: player.vehicle.grounded,
        }
      : null,
    wanted: {
      stars: wanted.stars,
      phase: wanted.phase,
      lastKnown: wanted.lastKnown,
    },
    population: {
      traffic: population.drivers.length,
      peds: population.pedestrians.length,
      police: population.policeStats,
    },
    crashCount,
    shots: combat.shots,
    props: damage.props.length,
    destroyed: [...damage.destroyed],
    paused,
    simTime,
    meshes: scene.meshes.length,
    activeMeshes: scene.getActiveMeshes().length,
    physicsBodies: physics.getBodies().length,
    streaming: world.getStreamingStats(),
    movement: {
      climbing: player.climbing,
      crouched: player.crouched,
      transitioning: player.transitioning,
    },
    atmosphere: atmosphere.getStats(),
    facility: population.facility.stats,
    audio: audio.getStats(),
    fps: engine.getFps(),
    resolution: [engine.getRenderWidth(), engine.getRenderHeight()],
    quality,
    frameTimes: frameTimes.latest(1800),
    streamingBusy: loadingWorld,
    errors: [],
  });
  Object.assign(window, {
    __leonida: {
      snapshot: diagnostics,
      ...(new URLSearchParams(location.search).has("test")
        ? {
            game: {
              player,
              vehicles,
              wanted,
              population,
              combat,
              damage,
              world,
              scene,
            },
            action: ui.onAction,
          }
        : {}),
    },
  });
}
boot().catch((error) => {
  console.error(error);
  ui.loading(
    "Unable to start: " +
      (error instanceof Error ? error.message : String(error)),
  );
  document.querySelector(".load-line")?.remove();
});
