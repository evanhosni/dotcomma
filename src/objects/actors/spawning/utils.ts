import type { TierRadius } from "./types";
import { DESPAWN_HYSTERESIS } from "./constants";

/**
 * THE ONE RADIUS RULE for every LOD tier (the actor pool, the sprite tier, any later one): a tier is just a
 * renderDistance. It loads at its spawn radius and drops at its despawn radius, 1.2× further out, so its
 * boundary never flickers.
 */

export const spawnRadiusOf = ({ renderDistance, footprint }: TierRadius): number => renderDistance + footprint / 2;

export const despawnRadiusOf = (tier: TierRadius): number => tier.despawnDistance ?? spawnRadiusOf(tier) * DESPAWN_HYSTERESIS;

/** An actor's id, and its sprite's: `${x}_${z}_${descriptorId}` from the spawn point's float64 coordinates.
 *  Never parsed back (descriptor ids may contain underscores). */
export const spawnPointId = (x: number, z: number, descriptorId: string): string => `${x}_${z}_${descriptorId}`;
