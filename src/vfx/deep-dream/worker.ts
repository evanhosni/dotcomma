import { createWorkerClient } from "../../utils/workers/workerClient";
import { DREAM_MODEL_PATH } from "./constants";

/** How long after the page's load the worker starts on its own (ms): past the boot's own burst of
 *  program links and chunk builds, which its ~87 links (each stalling the game's frame in Firefox)
 *  would have stretched. */
const PRELOAD_DELAY = 4000;

// Domain-agnostic, so never reset on a domain switch.
const deepDreamClient = createWorkerClient({
  create: () => new Worker(new URL("./deepDream.worker.ts", import.meta.url), { type: "module" }),
  // Absolute: the page's path is a fake address (pushState), and a worker resolves against its script.
  init: () => ({ modelUrl: new URL(`${process.env.PUBLIC_URL ?? ""}${DREAM_MODEL_PATH}`, window.location.origin).href }),
  resultType: "DREAMED",
});

export const startDeepDream = (): Promise<void> => deepDreamClient.ensure();
export const isDeepDreamReady = (): boolean => deepDreamClient.isReady();

let preloadScheduled = false;

/**
 * Starts the worker shortly after boot, effect on or not. Its start-up is ~4s of shader links that
 * share the browser's GPU-process thread with the game (src/vfx/DECISIONS.md): started on the first
 * frame the effect turned on, they dropped the game to ~55 fps with 100ms frames right then; here they
 * land on the landing page or the opening drop, and the effect turns on ready. The price is the
 * download (tfjs + 8.7MB of weights) for every visitor. Idempotent.
 */
export const preloadDeepDream = (): void => {
  if (preloadScheduled || typeof window === "undefined") return;
  preloadScheduled = true;
  const start = () => {
    const idle = (window as any).requestIdleCallback as ((cb: () => void, opts?: { timeout: number }) => number) | undefined;
    const run = () => void startDeepDream();
    setTimeout(() => (idle ? idle(run, { timeout: 2000 }) : run()), PRELOAD_DELAY);
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
};

/** RGBA bytes (rows bottom-up) → the same image a few DeepDream steps further. Transfers `pixels`. */
export const dreamStep = async (pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> => {
  const reply = await deepDreamClient.request<{ pixels: Uint8Array }>({ type: "DREAM", pixels, width, height }, [pixels.buffer]);
  return reply.pixels;
};
