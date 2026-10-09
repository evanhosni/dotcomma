/**
 * THE ONE RADIUS RULE for every LOD tier (the actor pool, the sprite tier, any later one): a tier is just a
 * renderDistance. It loads at its spawn radius and drops at its despawn radius, 1.2× further out, so its
 * boundary never flickers.
 */

const DESPAWN_HYSTERESIS = 1.2;

export interface TierRadius {
  renderDistance: number;
  footprint: number;
  /** An explicit drop distance (the actor tier's `despawnDistance`). */
  despawnDistance?: number;
}

export const spawnRadiusOf = ({ renderDistance, footprint }: TierRadius): number => renderDistance + footprint / 2;

export const despawnRadiusOf = (tier: TierRadius): number => tier.despawnDistance ?? spawnRadiusOf(tier) * DESPAWN_HYSTERESIS;
