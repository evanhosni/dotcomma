import { createWorkerClient } from "../../utils/workers/workerClient";
import { DREAM_MODEL_PATH } from "./constants";

// Domain-agnostic, so never reset on a domain switch. Created on the first frame the effect is on, so
// tfjs and the 17MB model load only for someone who turns it on.
const deepDreamClient = createWorkerClient({
  create: () => new Worker(new URL("./deepDream.worker.ts", import.meta.url), { type: "module" }),
  // Absolute: the page's path is a fake address (pushState), and a worker resolves against its script.
  init: () => ({ modelUrl: new URL(`${process.env.PUBLIC_URL ?? ""}${DREAM_MODEL_PATH}`, window.location.origin).href }),
  resultType: "DREAMED",
});

export const startDeepDream = (): Promise<void> => deepDreamClient.ensure();
export const isDeepDreamReady = (): boolean => deepDreamClient.isReady();

/** RGBA bytes (rows bottom-up) → the same image a few DeepDream steps further. Transfers `pixels`. */
export const dreamStep = async (pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> => {
  const reply = await deepDreamClient.request<{ pixels: Uint8Array }>({ type: "DREAM", pixels, width, height }, [pixels.buffer]);
  return reply.pixels;
};
