import { ParticleWriter } from "../../../particles/particleChunk";
import { MIST_LOOK, SPLASH_LOOK } from "../../../particles/particleMaterial";
import { seededStream } from "../../../utils/math/seededStream";
import type { SplashEmitter, SplashEmitterParams } from "../../../utils/workers/vertexCompute";
import { WATER_RENDER_ORDER } from "../../../world/terrain/chunkObjects";
import { createParticleDressing } from "./particleDressing";

/** The white water of every river fall (emitters: utils/workers/rivers/riverSplashes.ts): the spray in the
 *  plunge pool at its foot and the burst where its sheet strikes each boulder standing in it, each under a
 *  veil of MIST (a second layer from the same emitters: a few large, faint, slow quads drifting up and
 *  downstream). Rivers cross every region: one domain-level mount. Loads far (the shader thins it): a 320u
 *  pop read as "sometimes they don't render". Drawn ABOVE the water sheet, which writes no depth, the mist
 *  over the spray. */
const DEFAULT_RENDER_DISTANCE = 1000;
const EMITTERS: SplashEmitterParams = { minGrade: 0.25, spacing: 2.6, count: 24 };
/** The farthest a drop flies. */
const SPRAY_MAX_TRAVEL = 14;
/** Mist particles per spray particle, and the farthest one drifts (~8u) plus a far-grown quad's half
 *  size: the culling sphere must hold the whole quad, not just its centre. */
const MIST_SHARE = 0.08;
const MIST_MAX_TRAVEL = 30;

const emitSpray = (e: SplashEmitter, writer: ParticleWriter): void => {
  const stream = seededStream(`splash|${e.x},${e.z}`);
  const vigor = 0.35 + 0.65 * e.strength;
  // A pool's spray scatters over 3u and flies on downstream; a boulder's burst stands on its face,
  // climbs higher, throws wider, and some of it falls back upstream.
  const scatter = 3 - 1.5 * e.burst;
  for (let i = 0; i < e.count; i++) {
    const a = stream.next() * Math.PI * 2;
    const r = scatter * Math.sqrt(stream.next());
    const up = stream.between(2 + e.burst, 9 + 2 * e.burst) * vigor;
    const down = stream.between(0.5 - e.burst, 4 - 2 * e.burst) * vigor;
    const side = stream.between(-3 - e.burst, 3 + e.burst) * vigor;
    const life = stream.between(0.4, 1.6 - 0.3 * e.burst);
    const size = 0.4 + 3.6 * stream.next() ** 3;
    writer.push(e.x + Math.cos(a) * r, e.y, e.z + Math.sin(a) * r, e.dirX * down - e.dirZ * side, up, e.dirZ * down + e.dirX * side, life, stream.next() * life, size, stream.next());
  }
};

const emitMist = (e: SplashEmitter, writer: ParticleWriter): void => {
  const stream = seededStream(`mist|${e.x},${e.z}`);
  const count = Math.max(1, Math.round(e.count * MIST_SHARE));
  const vigor = 0.5 + 0.5 * e.strength;
  for (let i = 0; i < count; i++) {
    const a = stream.next() * Math.PI * 2;
    const r = 2.5 * Math.sqrt(stream.next());
    const up = stream.between(0.4, 1.2) * vigor;
    const down = stream.between(0.3, 1.2) * vigor;
    const side = stream.between(-0.5, 0.5);
    const life = stream.between(2.5, 5);
    const size = stream.between(8, 20) * (0.7 + 0.5 * e.strength);
    writer.push(e.x + Math.cos(a) * r, e.y + 0.5, e.z + Math.sin(a) * r, e.dirX * down - e.dirZ * side, up, e.dirZ * down + e.dirX * side, life, stream.next() * life, size, stream.next());
  }
};

export const RiverSplashes = createParticleDressing({
  name: "RiverSplashes",
  enumerator: "riverSplashes",
  emitters: EMITTERS,
  layers: [
    { look: SPLASH_LOOK, emit: emitSpray, maxTravel: SPRAY_MAX_TRAVEL, renderOrder: WATER_RENDER_ORDER + 1 },
    { look: MIST_LOOK, emit: emitMist, maxTravel: MIST_MAX_TRAVEL, renderOrder: WATER_RENDER_ORDER + 2 },
  ],
  defaultRenderDistance: DEFAULT_RENDER_DISTANCE,
});
