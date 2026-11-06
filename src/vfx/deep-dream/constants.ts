/** The image the network dreams on. Each step is a full forward + backward pass of MobileNet, so this is
 *  the effect's cost knob. FIXED whatever the screen's aspect (the dream is mapped through its camera's
 *  projection, so it needs none): tfjs's WebGL kernels are compiled per input shape, and a new shape
 *  recompiled hundreds of programs in one go. Multiples of 16, MobileNet's stride at DREAM_LAYER. */
export const DREAM_WIDTH = 320;
export const DREAM_HEIGHT = 176;

/** How much of the previous dream (reprojected onto the current view) the next step starts from; the
 *  rest is the fresh scene, which keeps the hallucination anchored to what is really there. */
export const DREAM_FEEDBACK = 0.92;

/** The dream's camera sees this many times the screen's extent (in clip space) around the view it was
 *  taken from, so a quick turn would still land on dreamed pixels; the price is that many fewer of its
 *  texels on screen (1.6 made the dream visibly coarser). Must be > 1: the margin holds the fade. */
export const DREAM_OVERSCAN = 1.2;

/** Width of the dream's faded border, in dream UV: exactly the part of the dream beyond the screen, so
 *  a still camera never shows any of it; only a turn brings the faded border on screen. */
export const DREAM_EDGE_FADE = (1 - 1 / DREAM_OVERSCAN) / 2;

/** How far past the screen edge (in screen UV) a fresh dream's coverage reaches, fading out. */
export const DREAM_EDGE_SPILL = 0.25;

/** A dream not refreshed for this long (s) is dropped: its camera is too far from the current one. */
export const DREAM_STALE_AFTER = 1;

/** The MobileNet v1 layer whose activations are maximized. Earlier = swirls and textures; later =
 *  eyes, fur and animal parts. Must be a layer of the linear chain in public/models/mobilenet. */
export const DREAM_LAYER = "conv_pw_12_relu";

/** Gradient-ascent steps per worker request, and each step's size in the network's [-1, 1] space
 *  (on a gradient normalized to mean |g| = 1). */
export const DREAM_STEPS = 2;
export const DREAM_STEP_SIZE = 0.02;

/** Octave scales, cycled one per request: the downscaled ones grow larger structures. */
export const DREAM_OCTAVES = [1, 0.6] as const;

/** Random shift (px) applied before each step and undone after, so the network's stride grid never
 *  imprints on the image. */
export const DREAM_JITTER = 16;

export const DREAM_MODEL_PATH = "/models/mobilenet/model.json";
