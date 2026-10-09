import type * as THREE from "three";
import type { SpriteDescriberName } from "./describers";

/** A kind's far tier (ActorAttributes.spriteLod): past the actor's own renderDistance it is drawn as an
 *  upright billboard out to this one, loaded and dropped by the same radius rule (spawning/radii.ts). */
export interface SpriteLodAttributes {
  renderDistance: number;
}

/** What a describer makes of one spawn point: the billboard's box (u) and the look's data
 *  (≤ SPRITE_DATA_FLOATS numbers; the first FRAGMENT_DATA_FLOATS also reach the fragment stage). */
export interface SpriteDescription {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** Pure and Three-free (it runs in the spawn worker): the same point always describes the same sprite.
 *  Null = no sprite for this point. */
export type SpriteDescriber = (attributes: Readonly<Record<string, unknown>>, x: number, z: number) => SpriteDescription | null;

/**
 * A member's far look (`ActorWarmupHooks.spriteLook`, a static on the member component). GLSL runs inside
 * the sprite base's MeshStandardMaterial (spriteMaterial.ts), which declares for it:
 *  - both stages: `spriteData[]` (vec4s; `spriteDatum(i)` reads float i) and the unpack helpers (layout.ts);
 *  - vertex `main`: `spriteViewAngle` (radians, atan(z, x) of `spriteViewDir`) and `spriteViewDir` (unit x/z
 *    direction from the sprite to the camera); all SPRITE_DATA_FLOATS data floats;
 *  - fragment `main`: `spriteUv` (0..1 across and up the box), `spriteSize` (the box, u), `spriteUvPixel`
 *    (fwidth of spriteUv, taken before any discard); the first FRAGMENT_DATA_FLOATS data floats.
 */
export interface SpriteLook {
  /** The SPRITE_DESCRIBERS entry that fills this look's data. One draw per look. */
  describer: SpriteDescriberName;
  /** Fragment `main`, after the base color: sets `diffuseColor.rgb`; may `discard` outside the silhouette. */
  fragment: string;
  /** Fragment `main`, after the emissive map: adds to `totalEmissiveRadiance`. */
  emissive?: string;
  /** Vertex `main`, before positioning: typically writes `flatVaryings`. */
  vertex?: string;
  /** Declarations without the qualifier ("vec3 vWidths"): declared `flat varying` in both stages. */
  flatVaryings?: string[];
  /** Before `main` in BOTH stages: uniform declarations and helpers (no stage-only builtins). */
  header?: string;
  uniforms?: Record<string, THREE.IUniform>;
  /** Default 0.85. */
  roughness?: number;
  /** Default 0.05. */
  metalness?: number;
  /** Every frame while the look's mesh is mounted. */
  update?: () => void;
}

/** One sprite kind as the generator thread sees it. */
export interface SpriteKindSource {
  /** The actor descriptor id. */
  id: string;
  describer: SpriteDescriberName;
  /** The sprite tier's renderDistance (its far fade ends there). */
  renderDistance: number;
  /** The descriptor's plain-data attributes (what the describer reads). */
  attributes: Record<string, unknown>;
}

/** A sprite kind on the client: its descriptor's far tier, resolved against its member's look. */
export interface SpriteKind {
  source: SpriteKindSource;
  look: SpriteLook;
  footprint: number;
}

/** One look's sprites in one chunk: ids are spawn-point ids; `instances` holds INSTANCE_FLOATS per id,
 *  x/z relative to the chunk's min corner. */
export interface SpriteChunkLook {
  describer: SpriteDescriberName;
  ids: string[];
  instances: Float32Array;
}

/** A generator's answer for one chunk. `failed`: generation threw (logged in the worker). */
export interface SpriteChunkResult {
  key: string;
  failed: boolean;
  looks: SpriteChunkLook[];
}
