import { SPAWN_CHUNK_SIZE } from "../actors/spawning/constants";
import { reportContentError } from "../../utils/utils";
import type { ActorWarmupHooks, AnyActorDescriptor } from "../actors/spawning/types";
import type { SpriteKind, SpriteLook } from "./types";
import { UNIT_STEPS, UNIT_RADIX } from "./constants";

/** Seconds; the sprite clock (arrival fades) on both the CPU and the GPU. */
export const spriteClock = (): number => performance.now() / 1000;

/** Distance from (x, z) to the nearest point of the spawn chunk whose min corner is given: the one rule
 *  for what a chunk's area reaches, on the client and in the generator threads. */
export const chunkGap = (x: number, z: number, chunkMinX: number, chunkMinZ: number): number => {
  const half = SPAWN_CHUNK_SIZE / 2;
  const dx = Math.max(0, Math.abs(x - chunkMinX - half) - half);
  const dz = Math.max(0, Math.abs(z - chunkMinZ - half) - half);
  return Math.sqrt(dx * dx + dz * dz);
};

/** Only structured-clone-safe values can reach the generator threads. */
const isPlainData = (value: unknown): boolean => {
  if (typeof value === "function" || typeof value === "symbol") return false;
  if (value === null || typeof value !== "object") return true;
  if (Array.isArray(value)) return value.every(isPlainData);
  return Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isPlainData);
};

/** Every descriptor with a `spriteLod`, by id. A kind whose member has no look, or two looks under one
 *  describer, are content errors. */
export const spriteKindsOf = (descriptors: AnyActorDescriptor[]): Map<string, SpriteKind> => {
  const kinds = new Map<string, SpriteKind>();
  const looks = new Map<string, SpriteLook>();
  for (const desc of descriptors) {
    if (!desc.spriteLod) continue;
    const look = (desc.component as ActorWarmupHooks).spriteLook;
    if (!look) {
      reportContentError(
        `[sprite-lod] "${desc.id}" has a spriteLod but its member component has no static \`spriteLook\` ` +
          `(ActorWarmupHooks): nothing would stand in for it past its renderDistance. Give the member a look or drop the spriteLod.`,
      );
      continue;
    }
    if ((looks.get(look.describer) ?? look) !== look) {
      reportContentError(`[sprite-lod] two different looks use the describer "${look.describer}": one look per describer.`);
      continue;
    }
    looks.set(look.describer, look);
    const attributes = Object.fromEntries(Object.entries(desc).filter(([key, value]) => key !== "component" && isPlainData(value)));
    kinds.set(desc.id, {
      look,
      footprint: desc.footprint,
      source: { id: desc.id, describer: look.describer, renderDistance: desc.spriteLod.renderDistance, attributes },
    });
  }
  return kinds;
};

/** Two values in [0, 1] in one float. */
export const packUnitPair = (high: number, low: number): number =>
  Math.round(Math.min(1, Math.max(0, high)) * UNIT_STEPS) * UNIT_RADIX + Math.round(Math.min(1, Math.max(0, low)) * UNIT_STEPS);

export const unpackUnitPair = (packed: number): [number, number] => [
  Math.floor(packed / UNIT_RADIX) / UNIT_STEPS,
  (packed % UNIT_RADIX) / UNIT_STEPS,
];

/** An sRGB hex color, 8 bits per channel, exact in float32. */
export const packColor = (hex: number): number => hex & 0xffffff;
