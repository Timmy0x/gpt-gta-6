import { VEHICLE_TUNING } from "../vehicles/handling";
import { PAINT_COLORS } from "../gameplay/Garage";
import type { WorldContract } from "../core/contracts";
import { COAST } from '../world/Coast';
import { MapViewport, playableMapPoint, type MapPoint } from './MapViewport';
export interface HudState {
  name: string;
  health: number;
  armor: number;
  breath?: number;
  cash: number;
  stars: number;
  phase: string;
  timer: number;
  speed: number;
  vehicle: string;
  weapon: string;
  ammo: number;
  reserve: number;
  reload: number;
  time: number;
  weather: string;
  fps: number;
  backend: string;
  position: { x: number; z: number };
  heading: number;
  prompt: string;
  activity: string;
  route: { x: number; z: number }[];
  destination: string;
  police: { x: number; z: number }[];
  peds: { x: number; z: number }[];
  vehicles: { x: number; z: number }[];
}
export class UI {
  ready = false;
  started = false;
  panel = "";
  onAction = (action: string, value?: string) => {};
  map: HTMLCanvasElement;
  world: WorldContract | null = null;
  settings: Record<string, string | number | boolean> = {};
  private padButtons: boolean[] = [];
  private padRepeat = 0;
  private readonly mapView = new MapViewport();
  private mapInitialized = false;
  private mapSelection: (MapPoint & { name?: string }) | null = null;
  private lastState?: HudState;
  toastTimer: ReturnType<typeof setTimeout> | null = null;
  constructor() {
    document.querySelector("#ui")!.innerHTML = `
    <div id="loading"><span class="eyebrow">A SINGLE-PLAYER WORLD</span><div class="wordmark">LEONIDA<span>FREE ROAM</span></div><p id="loading-text">Preparing the coast…</p><div class="load-line"><i></i></div></div>
    <main id="welcome" class="hidden"><div class="welcome-left"><div class="edition"><i></i> LOCAL DEVELOPMENT BUILD <span>01</span></div><p class="eyebrow">VICE CITY, LEONIDA</p><h1>MAKE YOUR<br>OWN <em>TROUBLE.</em></h1><p class="intro">The coast is yours. Take a walk, find a ride,<br>and see where the evening takes you.</p><button class="primary" data-action="play">ENTER FREE ROAM <span>↗</span></button><button class="text-button" data-action="continue">Continue saved sandbox <span>→</span></button><p id="welcome-status" role="status" aria-live="polite"></p><div class="welcome-controls"><span><kbd>W A S D</kbd> Move</span><span><kbd>E</kbd> Drive</span><span><kbd>F2</kbd> Sandbox</span></div></div><div class="welcome-foot"><span>LEONIDA / FREE ROAM</span><span>Original and licensed assets · Reconstruction in progress</span><span>BABYLON.JS × HAVOK</span></div></main>
    <div id="hud" class="hidden"><header class="hud-header"><div class="brand">LEONIDA <span>FREE ROAM</span></div><div class="top-right"><span id="clock">18:24</span><span class="weather" id="weather">CLEAR</span><button data-action="map" title="World map (M)" aria-label="World map">⌖ <kbd>M</kbd></button><button data-action="creative" title="Sandbox (F2)" aria-label="Sandbox">✦ <kbd>F2</kbd></button><button data-action="pause" title="Pause (Escape)">Ⅱ</button></div></header><section class="wanted-area"><div id="stars"></div><div id="wanted-state"></div></section><section class="location-card"><span class="eyebrow">VICE CITY</span><h2 id="district">Ocean Beach</h2><div id="activity"></div></section><div id="crosshair">·</div><div id="toast" class="hidden"></div><div id="prompt"></div><section class="bottom-left"><div class="map-wrap"><canvas id="minimap" width="224" height="184"></canvas><div class="north">N ↑</div><div class="map-caption">OCEAN BEACH <span>↗</span></div></div><div class="vitals"><span id="character">JASON</span><div class="bar"><i id="health-bar"></i></div><div class="bar armor"><i id="armor-bar"></i></div><div id="breath" class="bar breath hidden" role="progressbar" aria-label="Breath" aria-valuemin="0" aria-valuemax="30"><i id="breath-bar"></i></div></div></section><section class="bottom-right"><div id="vehicle-hud"></div><div class="weapon-info"><span id="weapon"></span><b id="ammo"></b></div><div id="money"></div></section><div id="performance"></div></div>
    <div id="scope" class="hidden" aria-hidden="true"><span></span></div><aside id="panel" class="hidden"></aside><div id="outcome" class="hidden"></div>`;
    this.map = document.querySelector("#minimap")!;
    document.querySelector("#ui")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
      if (b) this.onAction(b.dataset.action!, b.dataset.value);
    });
    document.querySelector("#panel")!.addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement;
      const action = el.dataset.change;
      if (action)
        this.onAction(
          action,
          el.type === "checkbox" ? String(el.checked) : el.value,
        );
    });
  }
  loading(s: string) {
    document.querySelector("#loading-text")!.textContent = s;
  }
  /** Standard controller menu navigation: D-pad/stick, A activate, B back. */
  pollGamepad(pad: Gamepad | null, dt: number) {
    const buttons = pad?.buttons.map((b) => b.pressed || b.value > 0.5) || [];
    const fresh = (i: number) => buttons[i] && !this.padButtons[i];
    let acted = false;
    if (pad && this.ready && (!this.started || this.panel)) {
      const scope = document.querySelector(
        this.started ? "#panel" : "#welcome",
      )!;
      const targets = [
        ...scope.querySelectorAll<HTMLElement>("button,input,select,a[href]"),
      ].filter((e) => !e.hidden && e.offsetParent !== null);
      let index = targets.indexOf(document.activeElement as HTMLElement);
      const direction =
        buttons[12] || pad.axes[1] < -0.5
          ? -1
          : buttons[13] || pad.axes[1] > 0.5
            ? 1
            : 0;
      this.padRepeat -= dt;
      if (direction && this.padRepeat <= 0 && targets.length) {
        index = (index + direction + targets.length) % targets.length;
        targets[index].focus();
        targets[index].scrollIntoView({ block: "nearest" });
        this.padRepeat = 0.22;
      }
      if (!direction) this.padRepeat = 0;
      const element = targets[index];
      if (fresh(0)) {
        if (!element) targets[0]?.focus();
        else if (element instanceof HTMLSelectElement) {
          element.selectedIndex =
            (element.selectedIndex + 1) % element.options.length;
          element.dispatchEvent(new Event("change", { bubbles: true }));
        } else element.click();
        acted = true;
      }
      const horizontal = fresh(14) ? -1 : fresh(15) ? 1 : 0;
      if (
        horizontal &&
        element instanceof HTMLInputElement &&
        element.type === "range"
      ) {
        horizontal > 0 ? element.stepUp() : element.stepDown();
        element.dispatchEvent(new Event("change", { bubbles: true }));
        acted = true;
      }
      if (fresh(1) && this.started) {
        this.onAction("close");
        acted = true;
      }
    }
    this.padButtons = buttons;
    return acted;
  }
  loaded() {
    this.ready = true;
    document.querySelector("#loading")!.classList.add("hidden");
    document.querySelector("#welcome")!.classList.remove("hidden");
  }
  start() {
    this.started = true;
    document.querySelector("#welcome")!.classList.add("hidden");
    document.querySelector("#hud")!.classList.remove("hidden");
  }
  toast(s: string, persistent = false) {
    const el = document.querySelector("#toast")!;
    el.textContent = s;
    const welcomeStatus = document.querySelector("#welcome-status")!;
    welcomeStatus.textContent = this.started ? "" : s;
    el.classList.toggle("hidden", !s);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = persistent ? null : setTimeout(() => { el.classList.add("hidden"); welcomeStatus.textContent = ""; }, 4000);
  }
  outcome(s: string) {
    const el = document.querySelector("#outcome")!;
    el.textContent = s;
    el.classList.toggle("hidden", !s);
  }
  showPanel(panel: string) {
    this.panel = panel;
    const el = document.querySelector("#panel")!;
    el.classList.toggle("hidden", !panel);
    el.classList.toggle("map-panel", panel === "map");
    if (!panel) return;
    const head = (label: string, sub: string) =>
      `<div class="panel-top"><span class="eyebrow">LEONIDA / ${sub}</span><button data-action="close">✕</button></div><h2>${label}</h2>`;
    if (panel === "creative")
      el.innerHTML =
        head("The world is yours.", "CREATIVE MODE") +
        `<p class="panel-sub">Build a little chaos. Every change happens in your sandbox.</p><div class="panel-scroll"><section><h3>YOUR NEXT RIDE</h3><div class="spawn-row"><select id="spawn-kind" aria-label="Vehicle">${Object.entries(VEHICLE_TUNING).map(([kind, tuning]) => `<option value="${kind}">${tuning.label} · ${kind}</option>`).join("")}</select><button data-action="spawn">Spawn ↗</button></div><div class="button-row"><button data-action="repair">Repair ride</button><button data-action="remove-vehicle">Remove nearest</button></div><div class="button-row"><button data-action="vehicle-lights">Toggle headlights</button><button data-action="vehicle-siren">Toggle siren</button></div><div class="button-row"><select id="prop-kind" aria-label="Prop"><option value="wood">Crate</option><option value="metal">Bin</option><option value="glass">Glass kiosk</option><option value="fence">Wood fence</option><option value="gate">Metal gate</option></select><button data-action="prop">Place prop</button><button data-action="ped">Spawn civilian</button><button data-action="weapons">Refill weapons</button></div><div class="button-row"><button data-action="remove-prop">Remove prop</button><button data-action="remove-ped">Remove civilian</button><button data-action="clear-weapons">Clear weapons</button></div><div class="button-row"><button data-action="ignite">Ignite nearest prop</button><button data-action="extinguish">Extinguish</button></div></section><section><h3>SET THE SCENE</h3><label>Time of day<input type="range" min="0" max="23.9" step=".1" value="17.5" data-change="time" aria-label="Time of day"/></label><label>Weather<select data-change="weather"><option>Clear</option><option>Rain</option><option>Haze</option></select></label><label>Pedestrian density<input type="range" min="0" max="1" step=".1" value="1" data-change="peds"/></label><label>Traffic density<input type="range" min="0" max="1" step=".1" value="1" data-change="traffic"/></label><label>Simulation speed<select data-change="sim-speed"><option value="1">Normal</option><option value=".5">Half speed</option><option value=".25">Quarter speed</option><option value="2">Double speed</option></select></label></section><section><h3>MAKE THE RULES</h3><label>Wanted level <select data-change="wanted"><option value="0">Clear</option><option value="1">★</option><option value="2">★★</option><option value="3">★★★</option><option value="4">★★★★</option><option value="5">★★★★★</option></select></label><label>Police response<input type="checkbox" checked data-change="police"/></label><label>Invulnerability<input type="checkbox" data-change="god"/></label><label>Unlimited ammunition<input type="checkbox" data-change="ammo"/></label><label>Flight / noclip<input type="checkbox" data-change="noclip"/></label><button class="wide" data-action="reset">Reset encounter</button></section><section><h3>KEEP THIS MOMENT</h3><div class="button-row"><button data-action="save">Save sandbox</button><button data-action="load">Load sandbox</button></div></section></div>`;
    if (panel === "map")
      el.innerHTML =
        head("Vice City", "WORLD MAP") +
        `<div class="map-layout"><div class="map-main"><div class="map-tools"><span>Pick a point</span><button data-map-command="in" title="Zoom in" aria-label="Zoom in">＋</button><button data-map-command="out" title="Zoom out" aria-label="Zoom out">−</button><button data-map-command="player" title="Find me" aria-label="Find me">⌖</button><button data-map-command="fit" title="Fit district" aria-label="Fit district">▣</button><button data-map-command="world" title="Whole map" aria-label="Whole map">◎</button></div><canvas id="bigmap" width="1000" height="620" tabindex="0" aria-label="World map. Drag to pan, scroll to zoom, click to select. Arrow keys move the selection."></canvas><div class="map-selection"><span id="map-point" role="status">Select a destination</span><button data-map-command="route" disabled>Route →</button><button data-map-command="travel" disabled>Travel ↗</button></div><div class="map-key"><span>● Places</span><span>◆ Selected</span><span>↑ You</span><button data-action="clear-route" aria-label="Clear route">Clear route</button></div></div><div class="map-places"><input id="location-search" placeholder="Find a place…" aria-label="Search locations"/><div id="locations">${this.world?.locations.map((l) => `<div class="location-row"><button data-map-location="${l.id}" title="Show ${l.name} on map"><span>${l.name}<small>${l.type}</small></span>⌖</button><button data-action="teleport" data-value="${l.id}" aria-label="Fast travel to ${l.name}">↗</button></div>`).join("")}</div></div></div>`;
    if (panel === "garage")
      el.innerHTML = head("Sunset Customs", "GARAGE") + `<p class="panel-sub">A fresh coat. A second chance.</p><section><h3>SERVICE YOUR RIDE</h3><button class="wide" data-action="garage-repair">Repair body and mechanical damage · $150</button><label>Paint color<select id="paint-color" aria-label="Paint color">${PAINT_COLORS.map(([color, name]) => `<option value="${color}">${name}</option>`).join("")}</select></label><button class="wide" data-action="garage-paint">Apply paint · $75</button></section><div class="button-row"><button data-action="close">Back to the street</button><button data-action="garage-exit">Exit vehicle</button></div>`;
    if (panel === "pause" || panel === "settings")
      el.innerHTML =
        head("Paused", "MENU") +
        `<button class="primary wide" data-action="close">RESUME <span>→</span></button><div class="button-row"><button data-action="save">Save sandbox</button><button data-action="load">Load sandbox</button></div><section><h3>CONTROLS</h3><div class="controls-grid"><kbd>W A S D</kbd><span>Move / steer</span><kbd>SHIFT</kbd><span>Sprint</span><kbd>SPACE</kbd><span>Jump / brake</span><kbd>E</kbd><span>Use</span><kbd>C</kbd><span>Lower</span><kbd>MOUSE</kbd><span>Look</span><kbd>RMB / LMB</kbd><span>Aim / fire</span><kbd>F / RB</kbd><span>Melee</span><kbd>TAB / LB</kbd><span>Weapons</span><kbd>R</kbd><span>Reload</span><kbd>ALT</kbd><span>Character</span><kbd>G / H</kbd><span>Recover vehicle / horn</span><kbd>L / J</kbd><span>Headlights / police siren</span><kbd>M / F2</kbd><span>Map / sandbox</span></div></section><section><h3>DISPLAY & AUDIO</h3><button data-action="credits">Asset credits</button><label>Quality<select data-change="quality"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Sound<input type="checkbox" checked data-change="sound"/></label><label>Performance display<input type="checkbox" data-change="stats"/></label><label>Remap action<select id="binding-action"><option value="forward">Forward</option><option value="back">Back</option><option value="left">Left</option><option value="right">Right</option><option value="sprint">Sprint</option><option value="jump">Jump</option><option value="interact">Interact</option><option value="crouch">Crouch</option><option value="reload">Reload</option><option value="switch">Character</option><option value="weaponWheel">Weapon wheel</option><option value="map">Map</option><option value="creative">Creative</option><option value="repair">Repair</option><option value="horn">Horn</option><option value="lights">Headlights</option><option value="siren">Siren</option><option value="melee">Melee</option></select></label><label>New key code<input type="text" placeholder="KeyW or Space" data-change="bind-key"/></label><small>Use keyboard codes such as KeyF, Space, ShiftLeft. Existing mappings swap when needed.</small></section>`;
    if (panel === "credits")
      el.innerHTML = head("Made with credit.", "ASSET CREDITS") + `<section><h3>ASTER CONCEPT</h3><p>Car Concept by Eric Chadwick, © 2024 Darmstadt Graphics Group GmbH, provided through the Khronos glTF Sample Assets library.</p><p>Licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>. Logos were removed and the model was adapted for vehicle controls, physical components and deformation.</p><p><a href="https://github.com/KhronosGroup/glTF-Sample-Assets/tree/44b6f9bdb08a5b16e92b91857ec3c87de9401dfa/Models/CarConcept" target="_blank" rel="noopener noreferrer">Original asset</a> · <a href="/vehicles/concept/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">Complete attribution and modifications</a></p></section><section><h3>WEAPON MODELS</h3><p>Pistol, carbine and sniper meshes by Tabasco, released under CC0. Adapted for scale, PBR materials and moving components.</p><p><a href="/weapons/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">Source and modifications</a></p></section><section><h3>PLAYER & CIVILIAN CHARACTERS</h3><p>Microsoft Rocketbox avatars · Copyright (c) 2020 Microsoft. Licensed under the MIT License. Original avatars by Rocketbox Studios, converted and retargeted for this game.</p><p><a href="https://github.com/microsoft/Microsoft-Rocketbox/tree/0943055db6ec570bcef9f2c8b41c9e5467c808f9" target="_blank" rel="noopener noreferrer">Source models</a> · <a href="/characters/rocketbox/LICENSE.txt" target="_blank" rel="noopener noreferrer">MIT License</a> · <a href="/characters/civilians/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">Civilian variants</a></p></section><section><h3>ENVIRONMENT LIGHTING</h3><p>Wide Street 02 by Sergej Majboroda, provided by Poly Haven under CC0. This public-domain asset was prefiltered for local game lighting. Powered by Poly Haven.</p><p><a href="https://polyhaven.com/a/wide_street_02" target="_blank" rel="noopener noreferrer">Source lighting</a> · <a href="/lighting/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">Attribution and modifications</a></p></section><section><h3>ROAD & BEACH SURFACES</h3><p>Asphalt 02 by Rob Tuytel and Dense Sand by Dimitrios Savva, provided by Poly Haven under CC0. Powered by Poly Haven.</p><p><a href="/surfaces/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">Sources and material attribution</a></p></section><section><h3>LEONIDA FREE ROAM</h3><p>Other current game geometry and synthesized audio are original prototype work. Reference reconstruction and visual development remain in progress.</p></section><button class="wide" data-action="pause">Back to settings</button>`;
    for (const element of el.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("[data-change]")) {
      const value = this.settings[element.dataset.change!];
      if (value === undefined) continue;
      if (element instanceof HTMLInputElement && element.type === "checkbox")
        element.checked = Boolean(value);
      else element.value = String(value);
    }
    if (panel === "map") {
      this.bindMap();
      document
        .querySelector("#location-search")
        ?.addEventListener("input", (e) => {
          const term = (e.target as HTMLInputElement).value.toLowerCase();
          document
            .querySelectorAll<HTMLElement>("#locations .location-row")
            .forEach(
              (b) => (b.hidden = !b.textContent?.toLowerCase().includes(term)),
            );
        });
    }
  }
  private bindMap(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#bigmap')!;
    const redraw = () => { if (this.lastState) this.drawMap(canvas, this.lastState, 1); };
    const fit = (wholeWorld = false) => this.mapView.fit(canvas.width, canvas.height, [...this.world?.roads ?? [], ...this.world?.locations ?? []], wholeWorld);
    if (!this.mapInitialized) { fit(); this.mapInitialized = true; }
    const select = (point: MapPoint & { name?: string }) => {
      if (!playableMapPoint(point)) return;
      this.mapSelection = point;
      const distance = this.lastState ? Math.round(Math.hypot(point.x - this.lastState.position.x, point.z - this.lastState.position.z)) : 0;
      document.querySelector('#map-point')!.textContent = `${point.name ?? (point.x > COAST.shorelineX ? 'Ocean pin' : 'Map pin')} · ${distance} m`;
      for (const button of document.querySelectorAll<HTMLButtonElement>('[data-map-command="route"], [data-map-command="travel"]')) button.disabled = false;
      redraw();
    };
    const pixel = (event: PointerEvent | WheelEvent) => {
      const box = canvas.getBoundingClientRect();
      return { x: (event.clientX - box.left) * canvas.width / box.width, y: (event.clientY - box.top) * canvas.height / box.height };
    };
    let drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
    canvas.addEventListener('pointerdown', event => { if (event.button !== 0) return; const p = pixel(event); drag = {id: event.pointerId, ...p, startX: p.x, startY: p.y, moved: false}; canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const p = pixel(event); drag.moved ||= Math.hypot(p.x - drag.startX, p.y - drag.startY) > 5;
      if (drag.moved) this.mapView.pan(p.x - drag.x, p.y - drag.y);
      drag.x = p.x; drag.y = p.y; redraw();
    });
    canvas.addEventListener('pointerup', event => {
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved) {
        const p = pixel(event), point = this.mapView.world(p.x, p.y, canvas.width, canvas.height);
        const nearest = this.world?.locations.map(location => ({location, distance: Math.hypot(location.x - point.x, location.z - point.z) * this.mapView.zoom})).sort((a, b) => a.distance - b.distance)[0];
        select(nearest && nearest.distance < 16 ? nearest.location : point);
      }
      drag = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('wheel', event => { event.preventDefault(); const p = pixel(event); this.mapView.zoomAt(Math.exp(-event.deltaY * .0015), p.x, p.y, canvas.width, canvas.height); redraw(); }, { passive: false });
    canvas.addEventListener('keydown', event => {
      const delta = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1]}[event.key];
      if (!delta) return; event.preventDefault();
      const p = this.mapSelection ?? this.lastState?.position ?? {x: this.mapView.x, z: this.mapView.z};
      select({x: p.x + delta[0] * 20 / this.mapView.zoom, z: p.z + delta[1] * 20 / this.mapView.zoom});
    });
    for (const button of document.querySelectorAll<HTMLElement>('[data-map-command]')) button.addEventListener('click', () => {
      const command = button.dataset.mapCommand;
      if (command === 'in' || command === 'out') this.mapView.zoomAt(command === 'in' ? 1.5 : 1 / 1.5, canvas.width / 2, canvas.height / 2, canvas.width, canvas.height);
      if (command === 'fit' || command === 'world') fit(command === 'world');
      if (command === 'player' && this.lastState) { this.mapView.x = this.lastState.position.x; this.mapView.z = this.lastState.position.z; this.mapView.zoom = Math.max(.8, this.mapView.zoom); }
      if ((command === 'route' || command === 'travel') && this.mapSelection) this.onAction(command === 'travel' ? 'teleport-point' : 'route-point', JSON.stringify(this.mapSelection));
      redraw();
    });
    for (const button of document.querySelectorAll<HTMLElement>('[data-map-location]')) button.addEventListener('click', () => {
      const location = this.world?.locations.find(p => p.id === button.dataset.mapLocation);
      if (location) { this.mapView.x = location.x; this.mapView.z = location.z; this.mapView.zoom = Math.max(.8, this.mapView.zoom); select(location); }
    });
    if (this.mapSelection) select(this.mapSelection); else redraw();
  }
  update(s: HudState) {
    this.lastState = s;
    const text = (id: string, value: string) => {
      const e = document.getElementById(id);
      if (e && e.textContent !== value) e.textContent = value;
    };
    text(
      "clock",
      `${String(Math.floor(s.time)).padStart(2, "0")}:${String(Math.floor((s.time % 1) * 60)).padStart(2, "0")}`,
    );
    text("weather", s.weather.toUpperCase());
    text("stars", "★".repeat(s.stars) + "☆".repeat(Math.max(0, 5 - s.stars)));
    document.getElementById("stars")!.classList.toggle("hot", s.stars > 0);
    text(
      "wanted-state",
      s.phase === "clear"
        ? ""
        : s.phase === "reporting"
          ? "WITNESS REPORTING"
          : s.phase === "pursuit"
            ? "POLICE PURSUIT"
            : s.phase === "search"
              ? "SEARCHING LAST KNOWN AREA"
              : "LOSING HEAT",
    );
    text("character", s.name.toUpperCase());
    document.getElementById("health-bar")!.style.width = `${s.health}%`;
    document.getElementById("armor-bar")!.style.width = `${s.armor}%`;
    const breath = document.getElementById("breath")!;
    breath.classList.toggle("hidden", s.breath == null || s.breath >= 30);
    breath.setAttribute("aria-valuenow", String(s.breath ?? 30));
    document.getElementById("breath-bar")!.style.width = `${Math.max(0, Math.min(100, (s.breath ?? 30) / 30 * 100))}%`;
    text("weapon", s.reload > 0 ? "RELOADING" : s.weapon.toUpperCase());
    text("ammo", `${s.ammo} / ${s.reserve}`);
    text("money", `$${s.cash.toLocaleString()}`);
    text("prompt", s.prompt);
    text("activity", s.destination || s.activity || "");
    text(
      "district",
      s.position.x > 155
        ? "Ocean Beach"
        : s.position.x < -450
          ? "West Vice City"
          : s.position.x < -95
          ? "Little Havana"
          : "Art Deco District",
    );
    text("performance", `${Math.round(s.fps)} FPS · ${s.backend}`);
    text(
      "vehicle-hud",
      s.vehicle
        ? `${Math.round(Math.abs(s.speed) * 3.6)} KM/H  /  ${s.vehicle.toUpperCase()}`
        : "",
    );
    this.drawMap(this.map, s, 1);
    const big = document.querySelector<HTMLCanvasElement>("#bigmap");
    if (big) this.drawMap(big, s, 0.95);
  }
  private drawMap(canvas: HTMLCanvasElement, s: HudState, scale: number) {
    const ctx = canvas.getContext("2d")!;
    const w = canvas.width,
      h = canvas.height;
    const big = w > 300;
    const zoom = big ? this.mapView.zoom : 1.5;
    const ox = big ? this.mapView.x : s.position.x,
      oz = big ? this.mapView.z : s.position.z;
    const xy = (p: { x: number; z: number }) => [
      w / 2 + (p.x - ox) * zoom,
      h / 2 - (p.z - oz) * zoom,
    ];
    ctx.fillStyle = "#101d22";
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 - ox * zoom, h / 2 + oz * zoom);
    ctx.scale(zoom, -zoom);
    ctx.fillStyle = "#293b38";
    ctx.fillRect(COAST.minX, COAST.minZ, COAST.maxX - COAST.minX, COAST.maxZ - COAST.minZ);
    ctx.fillStyle = "#397477";
    ctx.fillRect(210, COAST.minZ, COAST.maxX - 210, COAST.maxZ - COAST.minZ);
    ctx.fillStyle = "#9d9e82";
    ctx.fillRect(155, COAST.minZ, 55, COAST.maxZ - COAST.minZ);
    ctx.lineWidth = 12;
    ctx.strokeStyle = "#72807c";
    ctx.beginPath();
    const roads = this.world?.roads || [];
    const byId = new Map(roads.map((p) => [p.id, p]));
    for (const node of roads)
      for (const id of node.next) {
        const next = byId.get(id);
        if (!next) continue;
        ctx.moveTo(node.x, node.z);
        ctx.lineTo(next.x, next.z);
      }
    ctx.stroke();
    ctx.fillStyle = "#465450";
    for (const o of this.world?.obstacles || [])
      ctx.fillRect(o.x - o.w / 2, o.z - o.d / 2, o.w, o.d);
    if (s.route.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = "#c6a1ff";
      ctx.lineWidth = big ? 4 / zoom : 3 / zoom;
      s.route.forEach((p, i) =>
        i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z),
      );
      ctx.stroke();
    }
    ctx.restore();
    const dot = (p: { x: number; z: number }, color: string, r: number) => {
      const [x, y] = xy(p);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 7);
      ctx.fillStyle = color;
      ctx.fill();
    };
    for (const v of s.vehicles) dot(v, "#bdc8b7", 2);
    for (const p of s.police) dot(p, s.stars ? "#f36877" : "#7ebfe0", 3);
    const labelBoxes: {x: number; y: number; w: number}[] = [];
    if (big)
      for (const l of this.world?.locations || []) {
        const [x, y] = xy(l);
        if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
        dot(l, "#e8c191", 5);
        ctx.font = "13px sans-serif";
        ctx.fillStyle = "#f3e8d4";
        const labelWidth = ctx.measureText(l.name).width;
        if (!labelBoxes.some(b => Math.abs(b.y - y) < 19 && x + 9 < b.x + b.w && x + 9 + labelWidth > b.x)) {
          ctx.fillText(l.name, x + 9, y + 4); labelBoxes.push({x: x + 9, y, w: labelWidth});
        }
      }
    if (big && this.mapSelection) {
      const [x, y] = xy(this.mapSelection);
      ctx.strokeStyle = '#e1b8ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y - 13); ctx.lineTo(x + 10, y); ctx.lineTo(x, y + 13); ctx.lineTo(x - 10, y); ctx.closePath(); ctx.stroke();
    }
    if (big) {
      ctx.fillStyle = '#f3e8d4'; ctx.font = '14px sans-serif'; ctx.fillText('N ↑', w - 45, 27);
      const metres = [10, 20, 50, 100, 200, 500, 1000].find(n => n * zoom >= 70) ?? 1000;
      ctx.strokeStyle = '#f3e8d4'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(20, h - 24); ctx.lineTo(20 + metres * zoom, h - 24); ctx.stroke(); ctx.fillText(`${metres} m`, 20, h - 34);
    }
    const [px, py] = xy(s.position);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(s.heading);
    ctx.fillStyle = "#fff5dc";
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
