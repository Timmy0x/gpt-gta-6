import { Engine, WebGPUEngine, type AbstractEngine } from "@babylonjs/core";
import glslangJS from "@babylonjs/core/assets/glslang/glslang.js?url";
import glslangWASM from "@babylonjs/core/assets/glslang/glslang.wasm?url";
import twgslJS from "@babylonjs/core/assets/twgsl/twgsl.js?url";
import twgslWASM from "@babylonjs/core/assets/twgsl/twgsl.wasm?url";
export async function createRenderer(
  canvas: HTMLCanvasElement,
): Promise<{
  engine: AbstractEngine;
  backend: string;
  fallbackReason: string;
}> {
  let fallbackReason = "";
  const force = new URLSearchParams(location.search).get("backend");
  if (force !== "webgl")
    try {
      if (await WebGPUEngine.IsSupportedAsync) {
        const engine = new WebGPUEngine(canvas, {
          antialias: true,
          adaptToDeviceRatio: false,
          powerPreference: "high-performance",
        });
        try {
          await engine.initAsync(
            { jsPath: glslangJS, wasmPath: glslangWASM },
            { jsPath: twgslJS, wasmPath: twgslWASM },
          );
          return { engine, backend: "WebGPU", fallbackReason };
        } catch (e) {
          engine.dispose();
          throw e;
        }
      } else fallbackReason = "WebGPU adapter unavailable";
    } catch (e) {
      fallbackReason = String(e);
      console.warn("WebGPU unavailable, using WebGL2", e);
    }
  const engine = new Engine(
    canvas,
    true,
    {
      preserveDrawingBuffer: true,
      stencil: true,
      powerPreference: "high-performance",
    },
    false,
  );
  if (engine.webGLVersion < 2) {
    engine.dispose();
    throw new Error(
      "This build requires WebGL2 or WebGPU. Please open it in a supported desktop browser.",
    );
  }
  return { engine, backend: "WebGL2", fallbackReason };
}
