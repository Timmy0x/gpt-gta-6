import {
  validateVehicleSnapshot,
  type LegacyVehicleSnapshot,
  type SerializableVehicle,
} from "../vehicles/serialization";
import { validateCasualties, type PopulationCasualties } from "../gameplay/police/casualties";
export interface SavedProp {
  id: string;
  x: number;
  y: number;
  z: number;
  rotation: number[];
  material: "wood" | "metal" | "glass";
  health: number;
  burning: number;
  kind?: "street" | "fence" | "gate";
  vertices?: number[][];
}
export interface SaveData {
  version: 1;
  savedAt: string;
  player: {
    x: number;
    y: number;
    z: number;
    character: string;
    health: number;
    armor?: number;
  };
  time: number;
  weather: string;
  cash: number;
  vehicles: (LegacyVehicleSnapshot | SerializableVehicle)[];
  destroyed: string[];
  props?: SavedProp[];
  casualties?: PopulationCasualties;
  civilians?: {
    id?: string;
    x: number;
    y: number;
    z: number;
    health: number;
  }[];
  settings: Record<string, number | boolean | string>;
  combat?: { selected: number; magazines: number[]; reserves: number[] };
}
export class Persistence {
  static save(data: Omit<SaveData, "version" | "savedAt">) {
    const save: SaveData = {
      ...data,
      version: 1,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem("leonida.sandbox.v1", JSON.stringify(save));
    return save;
  }
  static load(): SaveData | null {
    try {
      const s = JSON.parse(
        localStorage.getItem("leonida.sandbox.v1") || "null",
      );
      if (
        !s ||
        s.version !== 1 ||
        !s.player ||
        !Array.isArray(s.vehicles) ||
        s.vehicles.length > 100 ||
        !Array.isArray(s.destroyed) ||
        s.destroyed.length > 10000 ||
        !s.settings
      )
        return null;
      for (const n of [
        s.player.x,
        s.player.y,
        s.player.z,
        s.player.health,
        s.time,
        s.cash,
      ])
        if (!Number.isFinite(n)) return null;
      if (
        !["Jason", "Lucia"].includes(s.player.character) ||
        !["Clear", "Rain", "Haze"].includes(s.weather)
      )
        return null;
      if (
        s.vehicles.some(
          (v: SaveData["vehicles"][number]) =>
            !v ||
            typeof v.kind !== "string" ||
            [v.x, v.y, v.z, v.heading, v.health].some(
              (n) => !Number.isFinite(n),
            ),
        )
      )
        return null;
      for (const vehicle of s.vehicles) validateVehicleSnapshot(vehicle);
      const vehicleIds = s.vehicles
        .map((v: SaveData["vehicles"][number]) => v.id)
        .filter(Boolean);
      if (
        new Set(vehicleIds).size !== vehicleIds.length ||
        s.destroyed.some((id: unknown) => typeof id !== "string")
      )
        return null;
      if (
        s.player.armor !== undefined &&
        (!Number.isFinite(s.player.armor) ||
          s.player.armor < 0 ||
          s.player.armor > 100)
      )
        return null;
      if (
        s.combat &&
        (!Number.isInteger(s.combat.selected) ||
          s.combat.selected < 0 ||
          s.combat.selected > 2 ||
          !Array.isArray(s.combat.magazines) ||
          !Array.isArray(s.combat.reserves) ||
          s.combat.magazines.length !== 3 ||
          s.combat.reserves.length !== 3 ||
          [...s.combat.magazines, ...s.combat.reserves].some(
            (n) => !Number.isInteger(n) || n < 0 || n > 1000000,
          ))
      )
        return null;
      if (
        s.combat?.magazines.some((n: number, i: number) => n > [12, 30, 3][i])
      )
        return null;
      if (
        s.props &&
        (!Array.isArray(s.props) ||
          s.props.length > 200 ||
          s.props.some(
            (p: SavedProp) =>
              !p ||
              typeof p.id !== "string" ||
              !Array.isArray(p.rotation) ||
              p.rotation.length !== 4 ||
              p.rotation.reduce((sum, n) => sum + n * n, 0) < 1e-9 ||
              (p.kind !== undefined &&
                !["street", "fence", "gate"].includes(p.kind)) ||
              (p.vertices !== undefined &&
                (!Array.isArray(p.vertices) ||
                  p.vertices.length > 100 ||
                  p.vertices.some(
                    (a) =>
                      !Array.isArray(a) ||
                      a.length > 50000 ||
                      a.some((n) => !Number.isFinite(n)),
                  ))) ||
              !["wood", "metal", "glass"].includes(p.material) ||
              [p.x, p.y, p.z, p.health, p.burning, ...(p.rotation || [])].some(
                (n) => !Number.isFinite(n),
              ),
          ))
      )
        return null;
      if (
        s.props &&
        new Set(s.props.map((p: SavedProp) => p.id)).size !== s.props.length
      )
        return null;
      if (
        s.civilians &&
        (!Array.isArray(s.civilians) ||
          s.civilians.length > 60 ||
          s.civilians.some(
            (p: NonNullable<SaveData["civilians"]>[number]) =>
              !p ||
              (p.id !== undefined &&
                (typeof p.id !== "string" || p.id.length > 120)) ||
              [p.x, p.y, p.z, p.health].some((n) => !Number.isFinite(n)),
          ))
      )
        return null;
      const civilianIds = (s.civilians || [])
        .map((p: { id?: string }) => p.id)
        .filter(Boolean);
      if (new Set(civilianIds).size !== civilianIds.length) return null;
      if (s.casualties !== undefined && !validateCasualties(s.casualties)) return null;
      return s;
    } catch {
      return null;
    }
  }
}
