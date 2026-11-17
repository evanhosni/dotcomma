/**
 * THE VALLEYS (computeVertexData step 3; world/water/README.md "Valleys"): land RISES AWAY FROM WATER.
 * Every biome and region has an ADDITIONAL HEIGHT (`additionalHeight`, real units, negative allowed) that
 * is 0 on every FLOOR — a river's or a pond's footprint, a lake, a biome whose own additional height is 0
 * (the city) — and grows in over its BLEND distance (`additionalHeightBlend`) from the nearest one, so water
 * lies in wide valleys and no bank is a step to the land around it. Both resolve biome → region → <Terrain>
 * and blend between biomes by a compact kernel over the biome sites (as the lake levels do), so a
 * mountain's 200 never meets its neighbour's 20 on the 300u height blend.
 *
 * A river's or a pond's distance is the river field's (generation/water/rivers/field/index.ts riverSample.gap, riverGapAt), exact out
 * to the walls' reach; a blend wider than that (the desert's) reads the rest off the far field (farGap). A
 * floor biome's is measured here — the zone walls reach only as far as the 5×5 biome grid — as the
 * distance to its voronoi territory, from the floor site's half-planes against every rising site near it
 * (the largest; exact where the nearest point lies on a wall, a little short near a corner, continuous
 * everywhere and 0 inside).
 *
 * The water's own probes (generation/water/utils.ts waterGroundAt) never see the valleys: a surface and a level are
 * read at the water's edge, where they are 0, and the pieces and discs the field holds are built from those
 * probes. Three-free.
 */

import { smoothstep } from "../../../utils/math";
import { CellCache } from "../../cache/CellCache";
import { domainConfig } from "../../store";
import type { Zone } from "../../types";
import { biomeSiteAt } from "../../zones";
import { isLakeBiome } from "../lakes/params";
import { farRiverGapAt, riverGapAt, widestWallReach } from "../rivers/field";

const heightOf = (zone: Zone): number => zone.biome.additionalHeight ?? zone.region.additionalHeight ?? domainConfig!.defaultAdditionalHeight;
const blendOf = (zone: Zone): number => zone.biome.additionalHeightBlend ?? zone.region.additionalHeightBlend ?? domainConfig!.defaultAdditionalHeightBlend;
/** A FLOOR the land rises from: a lake, and every biome that does not rise itself (its additional height
 *  0 — the city, whose crisp plateau carries its quays, sewers, decks and building pads level: risen by the
 *  kernel near a mountain, neighbouring pads stood 20u apart). */
const isFloor = (zone: Zone): boolean => isLakeBiome(zone.biome) || heightOf(zone) === 0;

/** A site's height reaches this far (real units): half its blend each side of a wall, but never under the
 *  span that always holds a site, so every point has one in reach. */
const kernelReach = (blend: number, gridSize: number): number => Math.max(blend / 2, 1.5 * gridSize);
/** A floor cell's territory lies within this many grid cells of its site; its rising neighbours within
 *  this many more. */
const TERRITORY_CELLS = 1.5;
const NEIGHBOUR_CELLS = 3;

/** Per domain: whether any zone lifts at all, and the widest blend (how far a window looks for sites). */
let lifts: boolean | null = null;
let widest = 0;
const scan = (): boolean => {
  const config = domainConfig!;
  widest = config.defaultAdditionalHeightBlend;
  let any = config.defaultAdditionalHeight !== 0;
  for (const region of config.regions) {
    widest = Math.max(widest, region.additionalHeightBlend ?? 0);
    if ((region.additionalHeight ?? 0) !== 0) any = true;
    for (const biome of region.biomes) {
      widest = Math.max(widest, biome.additionalHeightBlend ?? 0);
      if ((biome.additionalHeight ?? 0) !== 0) any = true;
    }
  }
  return any;
};
const anyLift = (): boolean => lifts ?? (lifts = scan());
/** The widest additional-height blend in the domain (real units). */
export const widestValleyBlend = (): number => {
  anyLift();
  return widest;
};

/** How many grid cells round a square hold every site within `distance` of it. */
const cellsWithin = (distance: number): number => Math.ceil(distance / domainConfig!.gridSize) + 1;
/** A site's distance from the square [x0, x1] × [z0, z1]. */
const awayFrom = (x: number, z: number, x0: number, z0: number, x1: number, z1: number): number => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));

/** The widest blend any point of the square [x0, x1] × [z0, z1] (warped) can have (0: nothing lifts): a
 *  point's blend is a weighted mean of the blends of the sites reaching it, and past it the point's lift is
 *  whole. How far the far field reads a gap there (generation/water/rivers/field/index.ts), so one wide blend (the desert's)
 *  widens only the reads near it. */
export const valleyBlendOver = (x0: number, z0: number, x1: number, z1: number): number => {
  if (!anyLift()) return 0;
  const gs = domainConfig!.gridSize;
  const k = cellsWithin(kernelReach(widest, gs));
  let most = 0;
  for (let ix = Math.floor(x0 / gs) - k; ix <= Math.floor(x1 / gs) + k; ix++) {
    for (let iz = Math.floor(z0 / gs) - k; iz <= Math.floor(z1 / gs) + k; iz++) {
      const site = biomeSiteAt(ix, iz);
      const blend = blendOf(site.zone);
      if (blend > most && awayFrom(site.x, site.z, x0, z0, x1, z1) < kernelReach(blend, gs)) most = blend;
    }
  }
  return most;
};

/** Per WINDOW (a square of warped space), the sites whose kernel reaches into it — position, height,
 *  blend, reach — and the floor sites whose territory may lie within the window's widest blend of it, by
 *  grid cell. */
const WINDOW = 125;
interface SiteWindow {
  n: number;
  x: Float64Array;
  z: Float64Array;
  height: Float64Array;
  blend: Float64Array;
  reach: Float64Array;
  floorX: number[];
  floorZ: number[];
  floorIx: number[];
  floorIz: number[];
  /** Each floor's landAround, attached on its first read in this window. */
  floorLand: (Float64Array | undefined)[];
}
const windows = new CellCache<SiteWindow>(16384);
const windowAt = (wx: number, wz: number): SiteWindow => {
  let w = windows.get(wx, wz);
  if (w) return w;
  const gs = domainConfig!.gridSize;
  const x0 = wx * WINDOW;
  const z0 = wz * WINDOW;
  const x1 = x0 + WINDOW;
  const z1 = z0 + WINDOW;
  const cx0 = Math.floor(x0 / gs);
  const cz0 = Math.floor(z0 / gs);
  const cx1 = Math.floor(x1 / gs);
  const cz1 = Math.floor(z1 / gs);
  // One pass finds the kernel's sites, and the floors (with their distance, as [ix, iz, away]) as far as
  // it reaches; only a window a wider blend reaches (the desert's) scans further for floors.
  const kernel: number[] = [];
  const floors: number[] = [];
  let most = 0;
  const k = cellsWithin(kernelReach(widest, gs));
  for (let ix = cx0 - k; ix <= cx1 + k; ix++) {
    for (let iz = cz0 - k; iz <= cz1 + k; iz++) {
      const site = biomeSiteAt(ix, iz);
      const away = awayFrom(site.x, site.z, x0, z0, x1, z1);
      const blend = blendOf(site.zone);
      const reach = kernelReach(blend, gs);
      if (away < reach) {
        if (blend > most) most = blend;
        kernel.push(site.x, site.z, heightOf(site.zone), blend, reach);
      }
      if (isFloor(site.zone)) floors.push(ix, iz, away);
    }
  }
  const floorReach = most + TERRITORY_CELLS * gs;
  const kf = cellsWithin(floorReach);
  if (kf > k) {
    floors.length = 0;
    for (let ix = cx0 - kf; ix <= cx1 + kf; ix++) {
      for (let iz = cz0 - kf; iz <= cz1 + kf; iz++) {
        const site = biomeSiteAt(ix, iz);
        if (isFloor(site.zone)) floors.push(ix, iz, awayFrom(site.x, site.z, x0, z0, x1, z1));
      }
    }
  }
  const floorX: number[] = [];
  const floorZ: number[] = [];
  const floorIx: number[] = [];
  const floorIz: number[] = [];
  for (let f = 0; f < floors.length; f += 3) {
    if (floors[f + 2] >= floorReach) continue;
    const site = biomeSiteAt(floors[f], floors[f + 1]);
    floorX.push(site.x);
    floorZ.push(site.z);
    floorIx.push(floors[f]);
    floorIz.push(floors[f + 1]);
  }
  const n = kernel.length / 5;
  w = { n, x: new Float64Array(n), z: new Float64Array(n), height: new Float64Array(n), blend: new Float64Array(n), reach: new Float64Array(n), floorX, floorZ, floorIx, floorIz, floorLand: [] };
  for (let s = 0; s < n; s++) {
    w.x[s] = kernel[s * 5];
    w.z[s] = kernel[s * 5 + 1];
    w.height[s] = kernel[s * 5 + 2];
    w.blend[s] = kernel[s * 5 + 3];
    w.reach[s] = kernel[s * 5 + 4];
  }
  windows.makeRoom();
  windows.set(wx, wz, w);
  return w;
};

/** A floor site's rising neighbours, NEAREST IT FIRST: per neighbour its position, 1 / (2 × its distance
 *  to the floor site) — so the half-plane distance is ((p − F)² − (p − s)²) × that — and half that distance.
 *  Fixed per floor, whatever window asks. */
const LAND_STRIDE = 4;
const floorLand = new CellCache<Float64Array>(4096);
const landAround = (ix: number, iz: number): Float64Array => {
  let land = floorLand.get(ix, iz);
  if (land) return land;
  const floor = biomeSiteAt(ix, iz);
  const out: [number, number, number][] = [];
  for (let i = -NEIGHBOUR_CELLS; i <= NEIGHBOUR_CELLS; i++) {
    for (let j = -NEIGHBOUR_CELLS; j <= NEIGHBOUR_CELLS; j++) {
      const s = biomeSiteAt(ix + i, iz + j);
      if (isFloor(s.zone)) continue;
      out.push([s.x, s.z, Math.hypot(s.x - floor.x, s.z - floor.z)]);
    }
  }
  out.sort((a, b) => a[2] - b[2]);
  land = new Float64Array(out.length * LAND_STRIDE);
  out.forEach(([x, z, gap], k) => land!.set([x, z, 1 / (2 * gap), gap / 2], k * LAND_STRIDE));
  floorLand.makeRoom();
  floorLand.set(ix, iz, land);
  return land;
};

/** Float slack on the half-plane bound below (warped units; the values it guards are ~1e-11 apart). */
const HALF_PLANE_SLACK = 1e-6;
/** The distance (warped units) from a point to the nearest floor territory in the window, up to `cap`.
 *  A neighbour s's half-plane distance is (p − F)·û − |s − F| / 2 ≤ |p − F| − |s − F| / 2, so once the
 *  neighbours (nearest the floor first) reach one whose half gap leaves no room over the largest found,
 *  none after it can raise it; and no distance is under 0, so a 0 ends the search. */
const floorDistance = (w: SiteWindow, px: number, pz: number, cap: number): number => {
  const territory = TERRITORY_CELLS * domainConfig!.gridSize;
  let best = cap;
  for (let s = 0; s < w.floorX.length; s++) {
    const dl2 = (px - w.floorX[s]) ** 2 + (pz - w.floorZ[s]) ** 2;
    if (dl2 >= (best + territory) ** 2) continue;
    const land = w.floorLand[s] ?? (w.floorLand[s] = landAround(w.floorIx[s], w.floorIz[s]));
    const dl = Math.sqrt(dl2) + HALF_PLANE_SLACK;
    let d = 0;
    for (let k = 0; k < land.length; k += LAND_STRIDE) {
      if (land[k + 3] >= dl - d) break;
      const h = (dl2 - (px - land[k]) ** 2 - (pz - land[k + 1]) ** 2) * land[k + 2];
      if (h > d) {
        d = h;
        if (d >= best) break;
      }
    }
    if (d < best) {
      best = d;
      if (best <= 0) return 0;
    }
  }
  return best;
};

/** The far field takes over from the near one over this many real units below the walls' reach. */
const FAR_GAP_HANDOVER = 250;
/** The gap past the walls' reach R, where the near field reads none: the near gap c = min(near, R), plus the
 *  far field's gap past R (its RAW pieces and ponds, on a lattice: generation/water/rivers/field/index.ts farRiverGapAt) faded in as
 *  c nears R. Continuous everywhere, exact below R − FAR_GAP_HANDOVER, and the far field's wherever no built
 *  water lies within R. Reading the built field itself out to the desert's 2500u blend cost +30% a cold
 *  desert square and every probe into one (generation/water/DECISIONS.md "The desert's wide valleys"). */
const farGap = (px: number, pz: number, near: number): number => {
  const reach = widestWallReach();
  const c = Math.min(near, reach);
  if (c <= reach - FAR_GAP_HANDOVER) return c;
  return c + Math.max(0, farRiverGapAt(px, pz) - reach) * smoothstep(reach - FAR_GAP_HANDOVER, reach, c);
};

/** The additional height at a warped point: its biomes' height, blended over the sites, grown in from 0 at
 *  the nearest water over their blend. `channelGap`: the real distance past the nearest river or pond
 *  footprint, where the caller has it (the vertex's own river field; Infinity: none counted), else read. */
export const valleyHeightAt = (px: number, pz: number, channelGap?: number): number => {
  if (!anyLift()) return 0;
  const w = windowAt(Math.floor(px / WINDOW), Math.floor(pz / WINDOW));
  let sum = 0;
  let height = 0;
  let blend = 0;
  for (let s = 0; s < w.n; s++) {
    const d2 = (px - w.x[s]) ** 2 + (pz - w.z[s]) ** 2;
    if (d2 >= w.reach[s] * w.reach[s]) continue;
    const k = (1 - Math.sqrt(d2) / w.reach[s]) ** 2;
    sum += k;
    height += k * w.height[s];
    blend += k * w.blend[s];
  }
  if (!(sum > 0) || height === 0) return 0;
  height /= sum;
  blend /= sum;
  const floor = floorDistance(w, px, pz, blend);
  if (floor <= 0) return 0;
  const near = channelGap ?? riverGapAt(px, pz);
  // A blend within the handover is whole wherever the far gap could count (c past it): skip the read.
  const water = Math.min(floor, blend > widestWallReach() - FAR_GAP_HANDOVER ? farGap(px, pz, near) : near);
  return water <= 0 ? 0 : height * smoothstep(0, blend, water);
};

export const clearValleys = (): void => {
  lifts = null;
  windows.clear();
  floorLand.clear();
};
