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
  x: number;
  z: number;
  next: number[];
}
export interface WorldContract {
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
