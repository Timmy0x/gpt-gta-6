import { clamp, distance, type Point2 } from "../core/math";
export type WantedPhase =
  | "clear"
  | "reporting"
  | "pursuit"
  | "search"
  | "cooldown";
export interface WantedProfile {
  maxStars: number;
  reportDelay: number;
  searchSeconds: number;
  cooldownSeconds: number;
}
export const FALLBACK_PROFILE: WantedProfile = {
  maxStars: 5,
  reportDelay: 3,
  searchSeconds: 26,
  cooldownSeconds: 9,
};
// Reference profile remains explicit until observed VI mechanics are independently inspected.
export class WantedSystem {
  stars = 0;
  heat = 0;
  phase: WantedPhase = "clear";
  timer = 0;
  lastKnown: Point2 = { x: 0, z: 0 };
  identifiedVehicle: string | null = null;
  identifiedCharacter = "Jason";
  reportPosition: Point2 | null = null;
  evidence = 0;
  visibility = 0;
  constructor(public profile: WantedProfile = { ...FALLBACK_PROFILE }) {}
  crime(severity: number, position: Point2, witnessed: boolean) {
    if (!witnessed) return false;
    this.heat = clamp(this.heat + severity, 0, this.profile.maxStars * 100);
    this.reportPosition = { x: position.x, z: position.z };
    this.evidence++;
    if (this.phase === "clear" || this.phase === "cooldown") {
      this.phase = "reporting";
      this.timer = this.profile.reportDelay;
    } else if (this.phase !== "reporting") {
      this.stars = clamp(Math.ceil(this.heat / 100), 1, this.profile.maxStars);
    }
    return true;
  }
  setLevel(level: number, position: Point2) {
    this.stars = clamp(Math.round(level), 0, this.profile.maxStars);
    this.heat = this.stars * 100;
    this.phase = this.stars ? "pursuit" : "clear";
    this.lastKnown = { x: position.x, z: position.z };
    this.timer = 0;
  }
  update(
    dt: number,
    position: Point2,
    seen: boolean,
    vehicleId: string | null,
    character: string,
  ) {
    this.visibility = seen ? 1 : 0;
    if (this.phase === "reporting") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.stars = clamp(
          Math.ceil(this.heat / 100),
          1,
          this.profile.maxStars,
        );
        this.lastKnown = {
          x: (this.reportPosition || position).x,
          z: (this.reportPosition || position).z,
        };
        this.phase = "pursuit";
        this.timer = 0;
      }
      return;
    }
    if (!this.stars) return;
    if (seen) {
      this.lastKnown = { x: position.x, z: position.z };
      this.identifiedVehicle = vehicleId;
      this.identifiedCharacter = character;
      this.phase = "pursuit";
      this.timer = 0;
      return;
    }
    this.timer += dt;
    if (this.phase === "pursuit" && this.timer > 4) {
      this.phase = "search";
      this.timer = 0;
    } else if (
      this.phase === "search" &&
      this.timer > this.profile.searchSeconds + (this.stars - 1) * 5
    ) {
      this.phase = "cooldown";
      this.timer = 0;
    } else if (
      this.phase === "cooldown" &&
      this.timer > this.profile.cooldownSeconds
    ) {
      this.stars = 0;
      this.heat = 0;
      this.phase = "clear";
      this.timer = 0;
    }
  }
  recognizes(position: Point2, vehicleId: string | null, character: string) {
    return (
      this.phase === "pursuit" ||
      (vehicleId === this.identifiedVehicle &&
        character === this.identifiedCharacter) ||
      distance(position, this.lastKnown) < 25
    );
  }
}
