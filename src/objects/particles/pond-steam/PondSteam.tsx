import { ParticleWriter } from "../ParticleWriter";
import { STEAM_LOOK } from "../material";
import { seededStream } from "../../../utils/math";
import type { PondSurfaceEmitter } from "../../../generation";
import { WATER_RENDER_ORDER } from "../../../world/terrain/chunk/constants";
import { createParticleDressing } from "../ParticleDressing";

/** Steam rising off a pond's still surface in tall soft plumes (emitters: utils/workers/water/parts
 *  `getPondSurfaceEmitters`): a PART of a channel body, rising off the ponds it owns (a <Pond>'s discs;
 *  a <Rivers> owns none since the river's own pond went, and a <Lake> is a content error), never off
 *  running water. Drawn ABOVE the water sheet, which writes no depth. Loads far: a pond should read as one
 *  from the next hill. */
const DEFAULT_RENDER_DISTANCE = 1000;
/** Emitters per km² of pond water; each plume's quads `size` across; and one breeze for every plume
 *  (`drift`, u/s along x/z), so a pond's steam leans one way. */
const KNOBS: { density: number; size: [number, number]; drift: { x: number; z: number } } = { density: 350, size: [10, 22], drift: { x: 0.45, z: 0.3 } };
const RISE: [number, number] = [2, 4];
const LIFE: [number, number] = [6, 11];
/** The highest rise plus the drift, plus a far-grown (2.2×) quad's half size. */
const maxTravel = ({ size, drift }: typeof KNOBS): number => RISE[1] * LIFE[1] + Math.hypot(drift.x, drift.z) * LIFE[1] * 1.5 + (size[1] * 2.2) / 2;

const emitSteam = (e: PondSurfaceEmitter, writer: ParticleWriter, { size, drift }: typeof KNOBS): void => {
  const stream = seededStream(`steam|${e.x},${e.z}`);
  for (let i = 0; i < e.count; i++) {
    const a = stream.next() * Math.PI * 2;
    const r = 3 * Math.sqrt(stream.next());
    const gust = stream.between(0.5, 1.5);
    const life = stream.between(...LIFE);
    writer.push(e.x + Math.cos(a) * r, e.y + 0.3, e.z + Math.sin(a) * r, drift.x * gust, stream.between(...RISE), drift.z * gust, life, stream.next() * life, stream.between(...size), stream.next());
  }
};

export const PondSteam = createParticleDressing({
  kind: "pondSteam",
  within: "channelBody",
  enumerator: "pondSurfaceEmitters",
  knobs: KNOBS,
  emitters: ({ density }) => ({ density, minDepth: 0.5, count: 12 }),
  seedTag: "steam",
  layers: [{ look: STEAM_LOOK, emit: emitSteam, maxTravel, renderOrder: WATER_RENDER_ORDER + 2 }],
  defaultRenderDistance: DEFAULT_RENDER_DISTANCE,
});
