import {
  validateVehicleSnapshot,
  type LegacyVehicleSnapshot,
  type SerializableVehicle,
} from "../vehicles/serialization";
export interface SavedProp {
  id: string;
  x: number;
  y: number;
  z: number;
  rotation: number[];
  material: "wood" | "metal" | "glass";
  health: number;
  burning: number;
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
  };
  time: number;
  weather: string;
  cash: number;
  vehicles: (LegacyVehicleSnapshot | SerializableVehicle)[];
  destroyed: string[];
  props?: SavedProp[];
  civilians?: { x: number; y: number; z: number; health: number }[];
  settings: Record<string, number | boolean | string>;
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
      if (
        s.props &&
        (!Array.isArray(s.props) ||
          s.props.length > 200 ||
          s.props.some(
            (p: SavedProp) =>
              !p ||
              typeof p.id !== "string" ||
              !["wood", "metal", "glass"].includes(p.material) ||
              [p.x, p.y, p.z, p.health, p.burning, ...(p.rotation || [])].some(
                (n) => !Number.isFinite(n),
              ),
          ))
      )
        return null;
      if (
        s.civilians &&
        (!Array.isArray(s.civilians) ||
          s.civilians.length > 60 ||
          s.civilians.some(
            (p: NonNullable<SaveData["civilians"]>[number]) =>
              !p || [p.x, p.y, p.z, p.health].some((n) => !Number.isFinite(n)),
          ))
      )
        return null;
      return s;
    } catch {
      return null;
    }
  }
}
