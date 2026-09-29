import type {
  AbstractMesh,
  Scene,
  ShadowGenerator,
  Vector3,
} from "@babylonjs/core";
export type VehicleKind =
  | "coupe"
  | "concept"
  | "sedan"
  | "suv"
  | "police"
  | "truck"
  | "hatchback"
  | "executive"
  | "van"
  | "offroad"
  | "mpv"
  | "boat"
  | "helicopter"
  | "plane"
  | "motorcycle";
export interface VehicleInput {
  throttle: number;
  steer: number;
  brake: number;
  handbrake: boolean;
  lift: number;
}
export interface Obstacle {
  x: number;
  z: number;
  w: number;
  d: number;
  height: number;
  /** Bottom of the physical obstacle in the current world coordinate frame. */
  baseY?: number;
  mesh?: AbstractMesh;
}
export interface WorldLocation {
  id: string;
  name: string;
  x: number;
  z: number;
  type: string;
}
export interface RoadNode {
  id: number;
  y?: number;
  x: number;
  z: number;
  next: number[];
}
export interface WorldPopulationSite {
  id: string;
  position: Vector3;
  target: Vector3;
  /** Native clear roadside waiting sites where the source has no sidewalk width. */
  stationary?: boolean;
}
export interface WorldContract {
  /** Stable public-source ambient sites; creation still requires native clearance. */
  readonly pedestrianSites?: readonly WorldPopulationSite[];
  collisionReady?: (position: Vector3) => boolean;
  /** Source coverage only; arrival still requires native support and clearance. */
  hasGroundCoverage?: (x: number, z: number, radius?: number) => boolean;
  readonly worldId?: string;
  readonly bounds?: import('../world/WorldBoundary').WorldBounds;
  readonly mapData?: import('../world/miami/types').MiamiDataset;
  readonly pedestrianSpawns?: Vector3[];
  readonly restrictedFacility?: boolean;
  readonly streetObjects?: import("../world/StreetObjectSystem").StreetObjects;
  spawn: Vector3;
  obstacles: Obstacle[];
  roads: RoadNode[];
  locations: WorldLocation[];
  waterLevel: number;
  update(dt: number, position: Vector3, time: number, weather: string): void;
  dispose(): void;
}
export interface BuildContext {
  scene: Scene;
  shadows: ShadowGenerator;
}
