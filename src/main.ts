import "./ui/style.css";
import {
  Color3,
  Color4,
  RawCubeTexture,
  Constants,
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
import { Input, type Action } from "./core/Input";
import { Persistence } from "./core/Persistence";
import { GameAudio } from "./core/Audio";
import { distance } from "./core/math";
import { World } from "./world/World";
import { VehicleSystem, type Vehicle, VEHICLE_TUNING } from "./vehicles";
import type { VehicleKind } from "./core/contracts";
import { Player } from "./gameplay/Player";
import { WantedSystem } from "./gameplay/Wanted";
import { Population } from "./gameplay/Population";
import { DamageSystem } from "./gameplay/Damage";
import { Combat } from "./gameplay/Combat";
import { UI } from "./ui/UI";
const ui = new UI();
async function boot() {
  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  ui.loading("Selecting a rendering backend…");
  const { engine, backend, fallbackReason } = await createRenderer(canvas);
  const scene = new Scene(engine);
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
  ui.loading("Building Ocean Beach and the Art Deco district…");
  await new Promise((r) => setTimeout(r, 20));
  // Authored low-frequency sky radiance: local data, with no remote asset dependency.
  const cubeFaces = Array.from({ length: 6 }, (_, face) => {
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const t = face === 2 ? 1 : face === 3 ? 0 : 1 - y / 31;
        const c = Color3.Lerp(
          new Color3(0.26, 0.29, 0.25),
          new Color3(0.58, 0.77, 0.9),
          t,
        );
        const i = (y * 32 + x) * 4;
        pixels[i] = c.r * 255;
        pixels[i + 1] = c.g * 255;
        pixels[i + 2] = c.b * 255;
        pixels[i + 3] = 255;
      }
    return pixels;
  });
  const environment = new RawCubeTexture(
    scene,
    cubeFaces,
    32,
    Constants.TEXTUREFORMAT_RGBA,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    true,
    false,
  );
  scene.environmentTexture = environment;
  scene.environmentIntensity = 0.85;
  const ctx = { scene, shadows };
  const world = new World(ctx);
  ui.world = world;
  const input = new Input(canvas);
  const player = new Player(scene, shadows, input, world.spawn);
  const vehicles = new VehicleSystem(ctx);
  vehicles.waterLevel = world.waterLevel;
  const startCar = vehicles.spawn("coupe", new Vector3(3, 1, -23), 0);
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
  const frameTimes: number[] = [];
  let raceMarker: Mesh | null = null;
  const racePoints = [
    new Vector3(0, 2, 65),
    new Vector3(72, 2, 144),
    new Vector3(144, 2, 72),
    new Vector3(72, 2, 0),
    new Vector3(0, 2, -72),
  ];
  function resetPlayer(reason: string) {
    player.exit();
    player.health = 100;
    player.armor = 50;
    player.deadTimer = 0;
    player.teleport(world.spawn.clone());
    population.reset();
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
  damage.onBreak = (p) => {
    audio.effect("impact", p);
  };
  combat.onSound = (kind, p) => audio.effect(kind, p);
  combat.onMessage = (s) => ui.toast(s);
  vehicles.onCrash = (v, severity, p) => {
    crashCount++;
    audio.effect("impact", p);
    if (v.occupied && severity > 4) {
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
        },
        time,
        weather,
        cash,
        vehicles: vehicles.list
          .filter((v) => !population.drivers.some((d) => d.v === v))
          .map((v) => vehicles.serialize(v)),
        destroyed: [...damage.destroyed],
        props: damage.serialize(),
        civilians: population.pedestrians
          .filter((p) => p.creative)
          .map((p) => ({
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
        },
      });
      ui.toast("Sandbox saved on this browser.");
    } catch (e) {
      ui.toast("Save failed: browser storage is unavailable or full.");
      console.error(e);
    }
  }
  function load() {
    const s = Persistence.load();
    if (!s) {
      ui.toast("No compatible saved sandbox in this browser.");
      return false;
    }
    player.exit();
    for (const v of [...vehicles.list])
      if (!population.drivers.some((d) => d.v === v)) vehicles.remove(v);
    const savedIds = new Set(s.vehicles.map((v) => v.id).filter(Boolean));
    population.drivers = population.drivers.filter(
      (d) => !savedIds.has(d.v.id),
    );
    for (const v of s.vehicles) vehicles.restore(v);
    player.teleport(new Vector3(s.player.x, s.player.y + 1, s.player.z));
    if (s.player.character !== player.name) player.switchCharacter();
    player.health = s.player.health;
    time = s.time;
    weather = s.weather;
    cash = s.cash;
    player.god = !!s.settings.god;
    player.noclip = !!s.settings.noclip;
    combat.unlimited = !!s.settings.ammo;
    population.density = Number(s.settings.peds ?? 1);
    population.trafficDensity = Number(s.settings.traffic ?? 1);
    if (s.props) damage.restoreState(s.props);
    else damage.restore(s.destroyed);
    for (const p of population.pedestrians.filter((p) => p.creative))
      p.model.dispose();
    population.pedestrians = population.pedestrians.filter((p) => !p.creative);
    population.reset();
    for (const p of s.civilians || []) {
      const ped = population.spawnPed(new Vector3(p.x, p.y, p.z));
      ped.health = p.health;
    }
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
    raceMarker?.dispose();
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
    if (player.vehicle) {
      if (player.vehicle.speed > 10) {
        ui.toast("Slow down before exiting.");
        return;
      }
      player.exit();
      return;
    }
    const v = nearestVehicle();
    if (v) {
      population.drivers = population.drivers.filter((d) => d.v !== v);
      player.enter(v);
      audio.start();
      ui.toast(
        `${v.tuning.label} · W/S throttle · A/D steer · Space handbrake · E exit`,
      );
      return;
    }
    const loc = world.locations.find((l) => distance(l, player.position) < 12);
    if (loc) {
      if (
        loc.type.includes("garage") ||
        loc.name.toLowerCase().includes("garage")
      ) {
        const v = nearestVehicle();
        if (v) vehicles.repair(v);
        player.health = 100;
        ui.toast("Garage service · Health and nearby ride restored.");
      } else if (
        loc.type.includes("race") ||
        loc.name.toLowerCase().includes("sprint")
      )
        beginRace();
      else {
        player.health = 100;
        combat.reserve = 180;
        cash = Math.max(0, cash - 50);
        ui.toast(`${loc.name} · Supplies purchased for $50.`);
      }
    }
  }
  ui.onAction = (action, value) => {
    if (action === "play" || action === "continue") {
      started = true;
      ui.start();
      ui.showPanel("");
      setPause(false);
      audio.start();
      if (action === "continue") load();
      canvas.focus();
      ui.toast("Walk to the sports coupe ahead. Press E to get in.");
      return;
    }
    if (["creative", "map", "pause"].includes(action)) {
      const panel = ui.panel === action ? "" : action;
      ui.showPanel(panel);
      setPause(panel === "pause" || panel === "map");
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
      let p = player.position.add(
        new Vector3(Math.sin(player.yaw) * 6, 1, Math.cos(player.yaw) * 6),
      );
      if (kind === "boat") p = new Vector3(239, 0.4, -230);
      if (kind === "plane") p = new Vector3(0, 1, -190);
      if (kind === "helicopter") p = new Vector3(0, 2, -112);
      const v = vehicles.spawn(kind, p, kind === "plane" ? 0 : player.yaw);
      ui.toast(
        `${v.tuning.label} spawned${kind === "boat" ? " at the marina" : kind === "plane" ? " at the south boulevard" : ""}.`,
      );
      if (["boat", "plane", "helicopter"].includes(kind)) {
        player.exit();
        player.teleport(p.add(new Vector3(3, 1, 0)));
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
        if (player.vehicle) player.exit();
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
      damage.spawn(player.position.add(new Vector3(2, 1, 3)));
      ui.toast("Physics crate spawned.");
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
      const prop = damage.props
        .filter((p) => p.health > 0)
        .sort(
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
      combat.ammo = 0;
      combat.reserve = 0;
      combat.reloadTime = 0;
      ui.toast("Weapons cleared.");
    }
    if (action === "weapons") {
      combat.reserve = 999;
      combat.ammo = combat.weapons[combat.weapon].capacity;
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
    if (action === "load") load();
    if (action === "reset") {
      population.reset();
      player.health = 100;
      player.armor = 50;
      ui.toast("Encounter reset.");
    }
    if (action === "teleport") {
      const l = world.locations.find((l) => l.id === value);
      if (l) {
        player.exit();
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
      if (player.vehicle)
        vehicles.control(player.vehicle, {
          throttle: input.axis("y"),
          steer: input.axis("x"),
          brake: input.down("back") && player.vehicle.forwardSpeed > 1 ? 1 : 0,
          handbrake: input.down("jump"),
          lift: Number(input.down("sprint")) - Number(input.down("crouch")),
        });
      combat.update(dt);
    }
    population.update(dt);
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
          raceMarker?.dispose();
          raceMarker = null;
          ui.toast(activity);
        } else raceMarker?.position.copyFrom(racePoints[raceIndex]);
      }
    }
  });
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
    frame++;
    input.poll();
    if (started) {
      if (input.pressed.has("Escape")) {
        input.pressed.delete("Escape");
        ui.onAction(ui.panel ? "close" : "pause");
      }
      if (input.take("creative")) ui.onAction("creative");
      if (input.take("map")) ui.onAction("map");
      if (!ui.panel) {
        if (input.take("interact")) interact();
        if (input.take("switch")) player.switchCharacter();
        if (input.take("repair")) ui.onAction("repair");
        if (input.take("reload")) combat.reload();
        if (input.take("horn")) audio.effect("siren", player.position);
        if (input.pressed.has("Digit1")) combat.select(0);
        if (input.pressed.has("Digit2")) combat.select(1);
        if (input.pressed.has("Digit3")) combat.select(2);
        if (input.pressed.has("KeyT")) beginRace();
      }
    }
    const solar = Math.max(0.08, Math.sin(((time - 6) / 24) * Math.PI * 2));
    ambient.intensity = 0.18 + solar * 0.3;
    sun.intensity = 0.25 + solar * 2.6;
    sun.direction.set(-0.65, -Math.max(0.15, solar), 0.32);
    sun.direction.normalize();
    sun.position.copyFrom(player.position.subtract(sun.direction.scale(150)));
    sun.diffuse = Color3.Lerp(
      new Color3(1, 0.6, 0.39),
      new Color3(1, 0.95, 0.84),
      solar,
    );
    scene.fogDensity =
      weather === "Rain" ? 0.003 : weather === "Haze" ? 0.004 : 0.00125;
    world.update(paused ? 0 : dt, player.position, time, weather);
    player.render(dt);
    audio.update(
      player.vehicle?.speed || 0,
      !!player.vehicle && !paused,
      paused ? 0 : wanted.stars,
      player.position,
    );
    scene.render();
    if (!ui.ready) {
      warmFrames = rawDt < 0.08 ? warmFrames + 1 : 0;
      if (warmFrames >= 8 || now - warmStarted > 20000) ui.loaded();
    }
    if (started && !paused) {
      frameTimes.push(rawDt * 1000);
      if (frameTimes.length > 108000) frameTimes.shift();
    }
    hudTime += dt;
    if (hudTime > 0.09) {
      hudTime = 0;
      closest = nearestVehicle();
      let prompt = player.vehicle
        ? "E  Exit vehicle · G  Repair / recover · T  Coastal sprint"
        : closest
          ? `E  Enter ${closest.tuning.label}`
          : "";
      if (!prompt) {
        const l = world.locations.find(
          (l) => distance(l, player.position) < 12,
        );
        if (l) prompt = `E  Interact · ${l.name}`;
      }
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
    fps: engine.getFps(),
    resolution: [engine.getRenderWidth(), engine.getRenderHeight()],
    quality,
    frameTimes: frameTimes.slice(-1800),
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
