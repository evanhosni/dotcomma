/**
 * The lamp-glow GRID DATA TEXTURE (CLAUDE.md → lighting/lamp-glow/index.ts): one glow head per
 * LAMP_CELL_SIZE cell (texel = xyz + color index + 1 + its fade, 0 = empty). Shaders read their 3×3
 * neighborhood — 9 reads per fragment, constant for any lamp count, and it lights the UNLIT
 * terrain that real point lights can't reach. Limitation: two heads in one cell → first wins.
 */
import * as THREE from "three";
import { getWindowLightsProgress } from "../day-night/store";
import { LAMP_GRID_SIZE, LAMP_CELL_SIZE, FADE_ENCODE, LAMP_FADE_SECONDS } from "./constants";
import type { LampHead } from "./types";

const gridData = new Float32Array(LAMP_GRID_SIZE * LAMP_GRID_SIZE * 4);
const gridTexture = new THREE.DataTexture(gridData, LAMP_GRID_SIZE, LAMP_GRID_SIZE, THREE.RGBAFormat, THREE.FloatType);
gridTexture.magFilter = THREE.NearestFilter;
gridTexture.minFilter = THREE.NearestFilter;
gridTexture.needsUpdate = true;

export const LAMP_GRID_UNIFORMS = {
  uLampGrid: { value: gridTexture },
  uLampGridOrigin: { value: new THREE.Vector2(0, 0) }, // cell coords of texel (0,0)
  uLampGlowIntensity: { value: 0 }, // global dusk/dawn ramp
};

let gridDirty = true;
let lastOriginX = Number.NaN;
let lastOriginZ = Number.NaN;
let lastHeadCount = -1;

/** Every add/remove/recolor of a head calls this, or the 64KB grid re-upload skips the change (the
 *  head-count check below is only a backstop and misses same-count swaps). */
const markLampGridDirty = (): void => {
  gridDirty = true;
};

/** A registered glow source and how lit it is; a released one fades out before it is deleted. */
interface HeadEntry {
  head: LampHead;
  fade: number;
  released: boolean;
}

const updateLampGrid = (entries: ReadonlyMap<string, HeadEntry>, cameraX: number, cameraZ: number): void => {
  const originX = Math.floor(cameraX / LAMP_CELL_SIZE) - LAMP_GRID_SIZE / 2;
  const originZ = Math.floor(cameraZ / LAMP_CELL_SIZE) - LAMP_GRID_SIZE / 2;
  if (!gridDirty && originX === lastOriginX && originZ === lastOriginZ && entries.size === lastHeadCount) {
    return;
  }

  gridData.fill(0);
  LAMP_GRID_UNIFORMS.uLampGridOrigin.value.set(originX, originZ);
  entries.forEach(({ head, fade }) => {
    if (fade <= 0) return;
    const p = head.position;
    const cx = Math.floor(p.x / LAMP_CELL_SIZE) - originX;
    const cz = Math.floor(p.z / LAMP_CELL_SIZE) - originZ;
    if (cx < 0 || cx >= LAMP_GRID_SIZE || cz < 0 || cz >= LAMP_GRID_SIZE) return;
    const idx = (cz * LAMP_GRID_SIZE + cx) * 4;
    const w = head.color + 1 + fade * FADE_ENCODE;
    // One head per cell: the first registered, unless a later one is more lit (a rebuilt chunk's head
    // fading in where a released one fades out).
    const held = gridData[idx + 3];
    if (held > 0 && held - Math.floor(held) >= w - Math.floor(w)) return;
    gridData[idx] = p.x;
    gridData[idx + 1] = p.y;
    gridData[idx + 2] = p.z;
    gridData[idx + 3] = w;
  });
  gridTexture.needsUpdate = true;
  gridDirty = false;
  lastOriginX = originX;
  lastOriginZ = originZ;
  lastHeadCount = entries.size;
};

/** Devmode's live mix over the dusk ramp (vfx/registry.ts); 1 = as designed. */
export const LAMP_GLOW_MIX = { value: 1 };

const setLampGlowIntensity = (value: number): void => {
  LAMP_GRID_UNIFORMS.uLampGlowIntensity.value = value * LAMP_GLOW_MIX.value;
};

/** Every mounted glow source. */
const lampHeads = new Map<string, LampHead>();
/** Read-only view (tests, debugging): add and remove heads with registerLampHeads. */
export const activeLampHeads: ReadonlyMap<string, LampHead> = lampHeads;
/** What the grid draws: every registered head plus the released ones still fading out. Insertion order
 *  decides which head wins a shared cell. */
export const glowEntries = new Map<string, HeadEntry>();
/** Some entry is fading in or out: the driver steps fades and rewrites the grid more often. */
let fadesPending = false;

let registrationCount = 0;

/**
 * THE way to add glow sources: registers `heads` under generated keys (they can never collide
 * with another feature's, or with a rebuilt chunk's), marks the grid dirty, and returns the
 * disposer that removes them. LampGlowDriver (mounted once in CustomCanvas) drives the grid
 * whenever any head is registered, so nothing else is needed. `source` only labels the keys.
 */
export const registerLampHeads = (source: string, heads: readonly LampHead[]): (() => void) => {
  const prefix = `${source}#${registrationCount++}:`;
  const keys = heads.map((head, i) => {
    const key = prefix + i;
    lampHeads.set(key, head);
    glowEntries.set(key, { head, fade: 0, released: false });
    return key;
  });
  fadesPending = fadesPending || keys.length > 0;
  markLampGridDirty();
  return () => unregisterLampHeads(keys);
};

export const setLampHeadColor = (head: LampHead, color: number): void => {
  if (head.color === color) return;
  head.color = color;
  markLampGridDirty();
};

/** Released heads fade out first; one never lit is gone at once. */
const unregisterLampHeads = (keys: Iterable<string>): void => {
  for (const key of keys) {
    lampHeads.delete(key);
    const entry = glowEntries.get(key);
    if (!entry) continue;
    if (entry.fade <= 0) glowEntries.delete(key);
    else entry.released = true;
  }
  fadesPending = true;
  markLampGridDirty();
  clearLampGridIfEmpty();
};

/** With no heads nobody drives the grid, so ghost light pools would linger on the terrain. */
const clearLampGridIfEmpty = (): void => {
  if (glowEntries.size === 0) {
    fadesPending = false;
    updateLampGrid(glowEntries, 0, 0);
    setLampGlowIntensity(0);
  }
};

/** Advances every fade by `dt`, deleting released heads once dark. Returns whether any is still fading. */
const stepFades = (dt: number): boolean => {
  const step = dt / LAMP_FADE_SECONDS;
  let fading = false;
  glowEntries.forEach((entry, key) => {
    if (entry.released) {
      entry.fade = Math.max(0, entry.fade - step);
      if (entry.fade <= 0) glowEntries.delete(key);
      else fading = true;
    } else if (entry.fade < 1) {
      entry.fade = Math.min(1, entry.fade + step);
      if (entry.fade < 1) fading = true;
    }
  });
  return fading;
};

const GRID_REWRITE_INTERVAL_FRAMES = 20; // frames between grid rewrites
/** While a head fades the grid is rewritten this often: ~20 steps over a 1s fade at 60fps. */
const FADE_REWRITE_INTERVAL_FRAMES = 3;

let lastDriveTime = -1;
let driveFrameCount = 0;

/** Time-guarded: the FIRST caller per frame does the work, so extra callers are harmless. */
export const driveLampLighting = (camera: THREE.Camera, time: number): void => {
  if (time === lastDriveTime) return;
  const dt = lastDriveTime < 0 ? 0 : Math.min(0.1, time - lastDriveTime);
  lastDriveTime = time;
  setLampGlowIntensity(getWindowLightsProgress());
  if (fadesPending) {
    fadesPending = stepFades(dt);
    markLampGridDirty();
  }
  // A change is drawn within a few frames; otherwise only the camera-following origin moves.
  const interval = gridDirty ? FADE_REWRITE_INTERVAL_FRAMES : GRID_REWRITE_INTERVAL_FRAMES;
  if (driveFrameCount++ % interval === 0) updateLampGrid(glowEntries, camera.position.x, camera.position.z);
  if (glowEntries.size === 0) clearLampGridIfEmpty();
};
