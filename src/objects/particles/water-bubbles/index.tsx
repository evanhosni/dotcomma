import { ParticleWriter } from "../chunk";
import { BUBBLE_LOOK } from "../material";
import { seededStream } from "../../../utils/math/seededStream";
import type { WaterEmitter } from "../../../utils/workers/vertexCompute";
import { createParticleDressing } from "..";

/** Bubbles rising off the bed of the body of water it is mounted in (<Lake>, <Rivers>, <Pond>; emitters:
 *  utils/workers/water/parts). Drawn UNDER the water sheet (order 0). */
const DEFAULT_RENDER_DISTANCE = 160;
/** Emitters per km² of the zone it stands in, none in water shallower than `minDepth`. */
const KNOBS = { density: 120, minDepth: 3 };
const PER_EMITTER = 6;
/** The farthest a bubble rises. */
const MAX_TRAVEL = 30;
const RISE_MIN = 0.6;
const RISE_MAX = 1.2;

const emitBubbles = (e: WaterEmitter, writer: ParticleWriter): void => {
  const stream = seededStream(`bubbles|${e.x},${e.z}`);
  for (let i = 0; i < e.count; i++) {
    const a = stream.next() * Math.PI * 2;
    const r = 1.2 * Math.sqrt(stream.next());
    const rise = stream.between(RISE_MIN, RISE_MAX);
    // Pops at the surface.
    const life = Math.min(MAX_TRAVEL, e.depth) / rise;
    writer.push(e.x + Math.cos(a) * r, e.y, e.z + Math.sin(a) * r, 0, rise, 0, life, stream.next() * life, stream.between(0.08, 0.2), stream.next());
  }
};

export const WaterBubbles = createParticleDressing({
  kind: "waterBubbles",
  within: "waterBody",
  enumerator: "waterEmitters",
  knobs: KNOBS,
  emitters: ({ density, minDepth }) => ({ density, minDepth, count: PER_EMITTER }),
  seedTag: "bubble",
  layers: [{ look: BUBBLE_LOOK, emit: emitBubbles, maxTravel: () => MAX_TRAVEL, renderOrder: 0 }],
  defaultRenderDistance: DEFAULT_RENDER_DISTANCE,
});
