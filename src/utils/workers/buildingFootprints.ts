import { generateBuildingPlan } from "../../objects/actors/building/generatePlan";
import { ringPoints } from "../../objects/actors/building/rings";
import { buildingSeedAt } from "../../objects/actors/building/spec";
import { getActorSpec } from "../../world/domains/configs";
import { dropOldestHalf } from "./cellCache";
import { getFlattenPoints } from "./flattenPads";

/**
 * Where the flatten-pad actors stand, as ground SILHOUETTES: a building's is its door band's ring (the
 * prismatic ground section of the same seeded plan Building.tsx draws — a pad's flat radius is narrower
 * than a canister's corners, and the proxy hull is fattened to contain the leaning floors above, which
 * left a bare strip around every wall), any other pad actor's its flat radius. Foliage uses it
 * to keep blades out of floors. Three-free.
 */

export interface Footprint {
  x: number;
  z: number;
  /** Convex silhouette relative to (x, z), counter-clockwise x/z pairs; null = the disc of `radius`. */
  ring: Float64Array | null;
  radius: number;
}

/** The widest half-extent a building shell reaches from its origin (interior cap 16u × the 1.5 width scale, rect corners). */
const MAX_FOOTPRINT_REACH = 36;

const ringCache = new Map<string, Float64Array | null>();

const silhouetteOf = (descId: string, x: number, z: number): Float64Array | null => {
  const spec = getActorSpec(descId);
  if (!spec?.hull || spec.component !== "building") return null;
  const seed = buildingSeedAt(x, z);
  const key = `${descId}|${seed}`;
  const cached = ringCache.get(key);
  if (cached !== undefined) return cached;
  if (ringCache.size > 4096) dropOldestHalf(ringCache);
  // lofts[0] is the door band (generatePlan's buildLofts); its bottom level is the ground ring.
  const band = generateBuildingPlan(seed, spec.hull).lofts[0];
  const points = band ? ringPoints(band.rect, band.sides, band.levels[0], band.ringRotation) : [];
  const count = points.length;
  const ring = count >= 3 ? new Float64Array(count * 2) : null;
  if (ring) {
    // ringPoints walks clockwise from above; insideFootprint wants counter-clockwise.
    for (let i = 0; i < count; i++) {
      const [px, pz] = points[count - 1 - i];
      ring[i * 2] = px;
      ring[i * 2 + 1] = pz;
    }
  }
  ringCache.set(key, ring);
  return ring;
};

/** Every pad actor whose silhouette may reach into the box. */
export const footprintsNear = (minX: number, minZ: number, maxX: number, maxZ: number): Footprint[] =>
  getFlattenPoints(minX - MAX_FOOTPRINT_REACH, minZ - MAX_FOOTPRINT_REACH, maxX + MAX_FOOTPRINT_REACH, maxZ + MAX_FOOTPRINT_REACH).map((p) => ({
    x: p.x,
    z: p.z,
    ring: silhouetteOf(p.descId, p.x, p.z),
    radius: p.radius,
  }));

/** Whether (x, z) lies within `margin` of the footprint. */
export const insideFootprint = (f: Footprint, x: number, z: number, margin: number): boolean => {
  const px = x - f.x;
  const pz = z - f.z;
  const ring = f.ring;
  if (!ring) return px * px + pz * pz < (f.radius + margin) ** 2;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const j = (i + 1) % n;
    const ex = ring[j * 2] - ax;
    const ez = ring[j * 2 + 1] - az;
    // Counter-clockwise: the inside is to the LEFT of every edge.
    if (ex * (pz - az) - ez * (px - ax) < -margin * Math.hypot(ex, ez)) return false;
  }
  return true;
};
