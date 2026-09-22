import { Persistence, type SaveData } from './Persistence';

// These releases share the same metre-scale frame, source building IDs and
// entity formats. R2 expands R1's coverage; it does not move the saved world.
const compatiblePredecessors: Readonly<Record<string, readonly string[]>> = {
  'brickell-public-common-frame-r2': ['brickell-public-common-frame-r1'],
};

/** Read an existing save without overwriting it. The normal save action writes
 * a new copy under the current world identity after successful restoration. */
export function loadCompatibleWorldSave(worldId: string): SaveData | null {
  const current = Persistence.load(worldId);
  if (current) return current;
  for (const previous of compatiblePredecessors[worldId] ?? []) {
    const save = Persistence.load(previous);
    if (save) return { ...save, worldId };
  }
  return null;
}
