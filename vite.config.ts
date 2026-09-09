import { defineConfig } from "vite";

export default defineConfig({
  // The GLB loader is intentionally lazy at runtime. Prebundle it in development so
  // the first detailed-car spawn cannot trigger a dependency-discovery page reload.
  optimizeDeps: { include: ["@babylonjs/core", "@babylonjs/havok", "@babylonjs/loaders/glTF/index.js"] },
});
