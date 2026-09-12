import { PBRMaterial, type Material, type Scene } from '@babylonjs/core';
import { GetSupportedSimultaneousLights } from '@babylonjs/core/Materials/materialHelper.functions';

/** glTF completion can raise every scene material's light count after creation. */
export class LightingBudget {
  private budgets = new WeakMap<Material, number>();
  private removeObservers: () => void;
  constructor(private scene: Scene) {
    for (const material of scene.materials) this.register(material);
    const added = scene.onNewMaterialAddedObservable.add(material => this.register(material));
    const before = scene.onBeforeRenderObservable.add(() => this.apply());
    this.removeObservers = () => {
      scene.onNewMaterialAddedObservable.remove(added);
      scene.onBeforeRenderObservable.remove(before);
    };
    this.apply();
  }
  private register(material: Material): void {
    const current = (material as Material & {maxSimultaneousLights?: number}).maxSimultaneousLights;
    if (current === undefined) return;
    const authored = material.metadata?.lightBudget;
    this.budgets.set(material, Number.isFinite(authored) ? Math.max(1, Math.min(8, authored)) : material instanceof PBRMaterial ? 8 : Math.min(8, current));
  }
  apply(): void {
    for (const material of this.scene.materials) {
      // Babylon announces a material during its base constructor, before
      // subclass lighting fields exist. Pick it up once initialization ends.
      if (!this.budgets.has(material)) this.register(material);
      const budget = this.budgets.get(material);
      if (budget === undefined) continue;
      const target = GetSupportedSimultaneousLights(this.scene, budget);
      const lit = material as Material & {maxSimultaneousLights: number};
      if (lit.maxSimultaneousLights !== target) lit.maxSimultaneousLights = target;
    }
  }
  dispose(): void { this.removeObservers(); }
}
