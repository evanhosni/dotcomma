/** Maps iterate in insertion order (≈ proximity to the player), so this evicts
 *  the far half — never clear(): a flatten tile costs 30–70ms to rebuild, and a
 *  full clear floods the next queries. */
export const dropOldestHalf = <K, V>(map: Map<K, V>): void => {
  let remaining = map.size >> 1;
  for (const key of map.keys()) {
    if (remaining-- <= 0) break;
    map.delete(key);
  }
};
