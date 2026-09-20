/**
 * The game-object attribute hierarchy (see CLAUDE.md → "The three game-object classes"):
 *
 *   GameObjectAttributes          every class
 *   ├─ ActorAttributes            actors/Actor.tsx (member types: ModelActorAttributes, BuildingAttributes)
 *   ├─ DressingAttributes         dressing/Dressing.tsx
 *   └─ FoliageAttributes          foliage/Foliage.tsx
 *
 * A field lives at the highest level where at least two users share it; member
 * attributes live next to the member.
 */

import type * as THREE from "three";

/** All optional here — a class's descriptor/props type re-declares the ones it requires. */
export interface GameObjectAttributes {
  renderDistance?: number;
  /** Actors default to renderDistance / 3; dressing to DRESSING_COLLIDER_DISTANCE; foliage has no colliders. */
  colliderDistance?: number;
  /** Unset = the global grid from <PostProcessing quantization>. Dressing is never quantized (instances are rebased). */
  quantization?: number;

  /** Unset = every biome. */
  biomeIds?: number[];
  heightRange?: [number, number];
  /** Degrees. */
  slopeRange?: [number, number];
  /** Distance to the city road centerline in normalized street units (roadWidth = 7 is the curb). */
  roadDistanceRange?: [number, number];

  /** Instances per 1,000,000 sq units. Structured dressing (markers, signals, poles) ignores density/footprint. */
  density?: number;
  /** Spacing radius in world units (foliage does not space). */
  footprint?: number;
}

export interface ActorAttributes extends GameObjectAttributes {
  /** 0 = uniform, 1 = heavily clustered. */
  clustering?: number;
  /** 0 = rarest (placed first), 100 = common. Default 50. */
  priority?: number;
  /** Min distance vs other descriptor ids. */
  spacingOverrides?: Record<string, number>;
  /** Default (renderDistance + footprint/2) * 1.2. */
  despawnDistance?: number;
  /** Inner radius where despawned objects can't REspawn. Default spawn radius * 0.5. */
  immediateRadius?: number;
  /** Bounds-radius multiplier for the frustum test. Default 3. */
  frustumPadding?: number;
  /** true = always grow the cursor on hover, false = never, unset = from triggers. */
  cursorOverride?: boolean;
  /** Default true: the server runs this actor's state machine as the one authority (CLAUDE.md → Entity sync). */
  serverSynced?: boolean;
  /** The terrain flattens a pad under every instance; placement becomes deterministic (vertexCompute.ts flatten engine). */
  flattenGround?: boolean;
  /** Default footprint * 0.45. */
  flattenRadius?: number;
  /** Default footprint * 0.35. */
  flattenSkirt?: number;
}

/** Empty today — every feature's knobs belong to its own placement enumerator. Kept as the class's extension point. */
export interface DressingAttributes extends GameObjectAttributes {}

export interface FoliageAttributes extends GameObjectAttributes {
  /** Degrees over which density fades and instances shorten at the slopeRange edges. */
  slopeBlend?: number;
  /** Tint multiplied over the texture ("#fff" keeps the texture's own colors). */
  color?: string;
  /** Public-URL billboard texture path (alpha-tested). */
  png?: string;
  /** MUST be a stable module-level function — its identity keys the material. */
  texture?: () => THREE.Texture;
  width?: number;
  height?: number;
  /** Max tip displacement in world units; 0 disables sway. */
  sway?: number;
  swaySpeed?: number;
  /** Two fields with the SAME seed and density land on identical points and grow through each other. */
  seed?: string;
}
