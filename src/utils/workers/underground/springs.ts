/**
 * SPRING SITES: where a river disappears into the mountain (rivers/riverPieceRules.ts placeSprings),
 * found per biome cell for the spring caves (caves.ts generateSpring, systems.ts). A site is the
 * river's last piece end: the mouth's opening stands on it, facing on along the river into the rock,
 * its floor just under the water. Three-free, a pure function of the river network.
 */

import { domainConfig } from "../computeConfig";
import { unwarp } from "../noise";
import { riverEdgeSprings } from "../rivers/riverPieceRules";
import { riverPiecesNear } from "../rivers/riverNetwork";
import { riverPieceEndSurface } from "../rivers/riverSurface";
import { zoneAtWarped } from "../voronoi";

export interface SpringSite {
  id: string;
  /** The opening, world coordinates. */
  x: number;
  z: number;
  /** Unit direction into the rock (on along the river), world. */
  dx: number;
  dz: number;
  /** The river's water surface at the opening. */
  surface: number;
  /** The river's real half-width at the opening (tapered toward it). */
  halfWidth: number;
}

/** How far along the river the direction is read, warped units. */
const DIRECTION_RUN = 10;

/** The spring sites whose opening lies in biome cell (ix, iz) of `biomeId`'s zone. */
export const springSitesInCell = (biomeId: number, ix: number, iz: number): SpringSite[] => {
  const gs = domainConfig!.gridSize;
  const x0 = ix * gs;
  const z0 = iz * gs;
  const x1 = x0 + gs;
  const z1 = z0 + gs;
  const out: SpringSite[] = [];
  const seen = new Set<string>();
  for (const p of riverPiecesNear(x0, z0, x1, z1, 0)) {
    const e = p.edge;
    for (const s of riverEdgeSprings(e)) {
      // The mouth piece: the built piece whose end is the spring's.
      if (s.forward ? p.index !== s.end - 1 : p.index !== s.end) continue;
      const id = `spring|${e.key}|${s.end}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const step = e.len / e.count;
      const wx = e.ax + e.ux * s.end * step;
      const wz = e.az + e.uz * s.end * step;
      if (wx < x0 || wx >= x1 || wz < z0 || wz >= z1) continue;
      if (zoneAtWarped(wx, wz).biome.id !== biomeId) continue;
      const sign = s.forward ? 1 : -1;
      const world = unwarp(wx, wz);
      const ahead = unwarp(wx + e.ux * sign * DIRECTION_RUN, wz + e.uz * sign * DIRECTION_RUN);
      const l = Math.hypot(ahead.x - world.x, ahead.z - world.z) || 1;
      const factor = s.forward ? p.w1 : p.w0;
      out.push({
        id,
        x: world.x,
        z: world.z,
        dx: (ahead.x - world.x) / l,
        dz: (ahead.z - world.z) / l,
        surface: riverPieceEndSurface(p, s.forward ? 1 : 0),
        halfWidth: domainConfig!.river.halfWidth * factor,
      });
    }
  }
  return out;
};
