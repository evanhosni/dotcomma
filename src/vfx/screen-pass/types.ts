import * as THREE from "three";

/** What a screen pass reads: the previous pass's color, and the SCENE's depth (no pass moves geometry). */
export interface ScreenFrame {
  color: THREE.Texture;
  depth: THREE.DepthTexture;
  width: number;
  height: number;
}

/** One full-screen effect in the chain. `render` draws into `output` (null = the screen), which the
 *  chain has already bound; a pass that draws elsewhere first binds `output` again before its last draw. */
export interface ScreenPass {
  isActive(): boolean;
  /** Links its programs now, not on first use. */
  warm(gl: THREE.WebGLRenderer): void;
  render(gl: THREE.WebGLRenderer, frame: ScreenFrame, output: THREE.WebGLRenderTarget | null, camera: THREE.Camera, time: number): void;
  dispose(): void;
}

/** What a liquid looks like from under it: the water's blue, or the sewers' green sewage — thicker
 *  (a third of the water's visibility) and blurrier. */
export type LiquidLook = "water" | "sewage";

/** The colours of the water the camera is in, as the sheet draws them there (generation/water/material.ts
 *  writeWaterColors): its shallow colour (RGB), and its deep colour with the depth that reaches it (RGB +
 *  depth). */
export interface CameraWaterColors {
  shallow: ArrayLike<number>;
  deep: ArrayLike<number>;
}
