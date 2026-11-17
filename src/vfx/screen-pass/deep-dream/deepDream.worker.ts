/* eslint-disable no-restricted-globals */
import * as tf from "@tensorflow/tfjs";
import { DREAM_HEIGHT, DREAM_JITTER, DREAM_LAYER, DREAM_OCTAVES, DREAM_STEP_SIZE, DREAM_STEPS, DREAM_WIDTH } from "./constants";

/**
 * The DeepDream thread: gradient ascent on the input image to maximize one MobileNet layer's mean
 * activation, a few steps per request. tfjs runs its WebGL backend on this thread's own OffscreenCanvas
 * context, so none of its JS (hundreds of ops per step) runs on the game's thread. Its GPU work and its
 * shader links do share the browser's GPU-process thread with the game: see compileInParallel.
 *
 * MobileNet v1 is a linear chain of (conv → batch norm → relu6) blocks, so the network up to DREAM_LAYER
 * is those blocks applied in order, eagerly — at ANY resolution, where the saved model's input is fixed
 * at 224×224.
 *
 * The blocks are run from their weights, not through the model's layers, because only the gradient
 * with respect to the IMAGE is wanted and tfjs-layers' path pays for much more (Firefox, d3d11):
 * - its convolutions are `fused.conv2d`, whose custom gradient computes the FILTER gradient too, every
 *   step (18 extra kernels, ~1.9s of linking, and their GPU time thrown away);
 * - a 1×1 conv's input gradient is `conv2DBackpropInput`, a shader looping over all output channels
 *   that the D3D compiler takes up to ~0.95s to link, 12 of them (~6s). As a matMul (the same maths
 *   tfjs's forward pass already uses for a 1×1 conv) its gradient is a matMul too;
 * - batch norm is folded into the conv's weights and a bias, once: its kernels and their gradients go.
 */

interface Block {
  kind: "conv" | "depthwise" | "pointwise";
  kernel: tf.Tensor;
  bias: tf.Tensor1D;
  strides: [number, number];
}

/** A layer of the saved model's topology (Keras JSON, snake_case config). */
interface LayerJson {
  class_name: string;
  config: { name: string; kernel_size?: number[]; strides?: [number, number]; padding?: string; use_bias?: boolean; epsilon?: number; activation?: string };
}

let blocks: Block[] = [];
let request = 0;

/**
 * The saved model's blocks up to DREAM_LAYER, each batch norm folded into its conv:
 * bn(conv(x, W)) = conv(x, W·s) + (β − μ·s), with s = γ / √(σ² + ε). Only those blocks' weight shards
 * are fetched: 8.7 of the model's 17MB (the last block and the classifier are never run).
 */
const loadBlocks = async (modelUrl: string): Promise<Block[]> => {
  const model = await (await fetch(modelUrl)).json();
  const layers: LayerJson[] = model.modelTopology.model_config.config.layers;
  const end = layers.findIndex((layer) => layer.config.name === DREAM_LAYER);
  if (end < 0) throw new Error(`deep dream: no layer "${DREAM_LAYER}" in the model`);
  const chain: { kind: Block["kind"]; conv: LayerJson; bn: LayerJson }[] = [];
  for (let i = 1; i <= end; i += 3) {
    const [conv, bn, act] = [layers[i], layers[i + 1], layers[i + 2]];
    const kind = conv.class_name === "DepthwiseConv2D" ? "depthwise" : conv.config.kernel_size?.[0] === 1 ? "pointwise" : "conv";
    if (!["Conv2D", "DepthwiseConv2D"].includes(conv.class_name) || conv.config.use_bias || conv.config.padding !== "same"
      || bn?.class_name !== "BatchNormalization" || act?.config.activation !== "relu6" || i + 2 > end
      || (kind === "pointwise" && conv.config.strides?.some((s) => s !== 1))) {
      throw new Error(`deep dream: "${conv.config.name}" is not a conv → batch norm → relu6 block ending at or before "${DREAM_LAYER}"`);
    }
    chain.push({ kind, conv, bn });
  }
  const kernelName = ({ kind, conv }: (typeof chain)[number]) => `${conv.config.name}/${kind === "depthwise" ? "depthwise_kernel" : "kernel"}`;
  const bnNames = (bn: LayerJson) => ["gamma", "beta", "moving_mean", "moving_variance"].map((w) => `${bn.config.name}/${w}`);
  const names = chain.flatMap((block) => [kernelName(block), ...bnNames(block.bn)]);
  const weights = await tf.io.loadWeights(model.weightsManifest, modelUrl.slice(0, modelUrl.lastIndexOf("/") + 1), names);
  const out = chain.map((block): Block => {
    const [gamma, beta, mean, variance] = bnNames(block.bn).map((name) => weights[name]);
    const [kernel, bias] = tf.tidy(() => {
      const scale = gamma.div(variance.add(block.bn.config.epsilon!).sqrt());
      const w = weights[kernelName(block)];
      return [
        block.kind === "depthwise"
          ? w.mul(scale.reshape([1, 1, -1, 1]))
          : block.kind === "pointwise" ? w.reshape([w.shape[2]!, w.shape[3]!]).mul(scale) : w.mul(scale),
        beta.sub(mean.mul(scale)),
      ];
    });
    return { kind: block.kind, kernel, bias: bias as tf.Tensor1D, strides: block.conv.config.strides ?? [1, 1] };
  });
  tf.dispose(weights);
  return out;
};

const activation = (image: tf.Tensor3D): tf.Scalar => {
  let y: tf.Tensor4D = image.expandDims(0);
  for (const { kind, kernel, bias, strides } of blocks) {
    const [, h, w, c] = y.shape;
    const z: tf.Tensor4D = kind === "pointwise"
      ? tf.matMul(y.reshape([h * w, c]), kernel as tf.Tensor2D).reshape([1, h, w, kernel.shape[1]!])
      : kind === "depthwise"
        ? tf.depthwiseConv2d(y, kernel as tf.Tensor4D, strides, "same")
        : tf.conv2d(y, kernel as tf.Tensor4D, strides, "same");
    // tfjs-layers' relu6, exactly: min(6, relu(x)).
    y = tf.minimum(6, tf.relu(z.add(bias)));
  }
  return y.mean() as tf.Scalar;
};

const gradients = DREAM_OCTAVES.map((scale) =>
  tf.grad((image: tf.Tensor) => {
    const img = image as tf.Tensor3D;
    if (scale === 1) return activation(img);
    const [h, w] = img.shape;
    return activation(tf.image.resizeBilinear(img, [Math.round(h * scale), Math.round(w * scale)]));
  }),
);

/** out[i] = x[(i - shift) mod n]. */
const rollIndices = (n: number, shift: number): tf.Tensor1D =>
  tf.tensor1d(Int32Array.from({ length: n }, (_, i) => (((i - shift) % n) + n) % n), "int32");

/** Circular shift along height and width, as a gather: the shift is DATA, so one program serves every
 *  shift (a concat of two slices bakes the split into its shader: one new program per jitter value). */
const roll = (x: tf.Tensor3D, dy: number, dx: number): tf.Tensor3D => {
  const [h, w] = x.shape;
  return x.gather(rollIndices(h, dy), 0).gather(rollIndices(w, dx), 1);
};

/** The dream's ops on RGBA bytes (rows bottom-up), to RGB floats in [0, 255], same layout. Inside a tidy. */
const dreamOps = (pixels: Uint8Array, width: number, height: number, grad: (typeof gradients)[number]): tf.Tensor => {
  // Upright for the network (it learned upright dogs), and MobileNet's [-1, 1] input range.
  let x = tf.browser
    .fromPixels({ data: pixels, width, height } as any)
    .reverse(0)
    .toFloat()
    .div(127.5)
    .sub(1) as tf.Tensor3D;
  for (let i = 0; i < DREAM_STEPS; i++) {
    const dy = Math.round((Math.random() * 2 - 1) * DREAM_JITTER);
    const dx = Math.round((Math.random() * 2 - 1) * DREAM_JITTER);
    const shifted = roll(x, dy, dx);
    const g = grad(shifted);
    const step = g.div(g.abs().mean().add(1e-8)).mul(DREAM_STEP_SIZE);
    x = roll(shifted.add(step).clipByValue(-1, 1) as tf.Tensor3D, -dy, -dx);
  }
  return x.add(1).mul(127.5).reverse(0);
};

/**
 * Compiles every kernel the dream uses OFF the GPU-process thread, where the browser has
 * KHR_parallel_shader_compile (Chrome). Every WebGL context of the browser shares that thread, so a
 * program linked on it stalls the GAME's frame too: linked as they come on the first step, and checked
 * at once, ~75 programs held the game at 50–100ms frames for ~4s. Run once in tfjs's compile-only mode,
 * they are all handed over unchecked, link in parallel, and are polled.
 * Without the extension (Firefox) each link blocks that thread whoever waits on it, and replaying them
 * one per rest gave no fewer frames over 50ms (src/vfx/DECISIONS.md), so the first real steps compile them.
 */
const compileInParallel = async (): Promise<void> => {
  const backend = tf.backend() as any;
  if (!backend.gpgpu?.parallelCompilationExtension) return;
  tf.env().set("ENGINE_COMPILE_ONLY", true);
  try {
    const blank = new Uint8Array(DREAM_WIDTH * DREAM_HEIGHT * 4);
    for (const grad of gradients) tf.tidy(() => void dreamOps(blank, DREAM_WIDTH, DREAM_HEIGHT, grad));
  } finally {
    tf.env().set("ENGINE_COMPILE_ONLY", false);
  }
  await backend.checkCompileCompletionAsync();
  backend.getUniformLocations();
};

/** RGBA bytes, rows bottom-up (straight from readPixels) → dreamed RGBA bytes, same layout; the alpha
 *  (where the feed holds a dream or the scene) passes through. */
const dream = async (pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> => {
  const grad = gradients[request++ % gradients.length];
  const out = tf.tidy(() => dreamOps(pixels, width, height, grad));
  const rgb = await out.data();
  out.dispose();
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgba[i] = rgb[j];
    rgba[i + 1] = rgb[j + 1];
    rgba[i + 2] = rgb[j + 2];
    rgba[i + 3] = pixels[i + 3]; // coverage: the network leaves it alone
  }
  return rgba;
};

self.onmessage = async (e: MessageEvent) => {
  const data = e.data;
  if (data.type === "INIT") {
    try {
      const t0 = performance.now();
      // Shapes as uniforms: one program per kernel, not one per kernel per tensor shape.
      tf.env().set("WEBGL_USE_SHAPES_UNIFORMS", true);
      // The first conv's input gradient (the only conv2DBackpropInput left) as the unpacked shader: the
      // packed one loops over its output channels three times over and links in ~250ms (Firefox, d3d11).
      tf.env().set("WEBGL_PACK_CONV2DTRANSPOSE", false);
      await tf.ready();
      blocks = await loadBlocks(data.modelUrl);
      await compileInParallel();
      // One real dream per octave: without parallel compilation this is where every kernel compiles;
      // with it, what only a real run needs (the read-back's programs, the textures).
      for (let i = 0; i < DREAM_OCTAVES.length; i++) {
        await dream(new Uint8Array(DREAM_WIDTH * DREAM_HEIGHT * 4), DREAM_WIDTH, DREAM_HEIGHT);
      }
      console.log(`[deep dream] ${tf.getBackend()} backend, dreaming on ${DREAM_LAYER}, ready in ${Math.round(performance.now() - t0)}ms`);
      self.postMessage({ type: "INIT_DONE" });
    } catch (err) {
      console.error("[deep dream] failed to start", err);
    }
    return;
  }
  if (data.type === "DREAM") {
    const pixels = await dream(data.pixels, data.width, data.height);
    self.postMessage({ type: "DREAMED", id: data.id, pixels }, [pixels.buffer] as any);
  }
};
