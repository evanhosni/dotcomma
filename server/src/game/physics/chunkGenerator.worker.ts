import { parentPort, workerData } from "node:worker_threads";
import type { DomainId } from "../../../../src/net/protocol";
import { computeVertexData, initCompute } from "../../../../src/utils/workers/vertexCompute";
import { DOMAIN_CONFIGS } from "../../../../src/world/domains/configs";
import type { ChunkGeneratorReply, ChunkGeneratorRequest, ChunkLayer, ChunkLayerData } from "./chunkGenerator.js";
import { enumerateObstacles } from "./obstaclePoints.js";
import { sampleChunkHeights } from "./terrain.js";

/**
 * The CPU half of chunk generation (heights, dressing points) off the tick's thread: the same
 * computeVertexData on the same shared DomainConfig, so its output is the in-thread output
 * bit for bit. Jobs run one per macrotask so a cancel posted behind a request can still drop it;
 * height queries go before every queued chunk (a tick is waiting on them, and they take ~ms here).
 */

type Job = ChunkGeneratorRequest & { t: "job" };
type HeightQuery = ChunkGeneratorRequest & { t: "height" };

const SAMPLERS: { [L in ChunkLayer]: (gx: number, gz: number) => { data: ChunkLayerData[L]; transfer: ArrayBuffer[] } } = {
  terrain: (gx, gz) => {
    const heights = sampleChunkHeights(gx, gz);
    return { data: heights, transfer: [heights.buffer as ArrayBuffer] };
  },
  // Not transferred: a point's mesh arrays may be views the enumerator keeps cached.
  dressing: (gx, gz) => ({ data: enumerateObstacles(gx, gz), transfer: [] }),
};

const port = parentPort!;
initCompute(DOMAIN_CONFIGS[(workerData as { domain: DomainId }).domain]!); // PhysicsWorld.create checked it

const queue = new Map<number, Job>();
const heights: HeightQuery[] = [];
let pumping = false;

const run = (id: number, job: Job): void => {
  try {
    const { data, transfer } = SAMPLERS[job.layer](job.gx, job.gz);
    port.postMessage({ id, data } satisfies ChunkGeneratorReply, transfer);
  } catch (err) {
    port.postMessage({ id, error: err instanceof Error ? err.stack ?? err.message : String(err) } satisfies ChunkGeneratorReply);
  }
};

const answerHeight = ({ id, x, z }: HeightQuery): void => {
  try {
    port.postMessage({ id, data: computeVertexData(x, z).height } satisfies ChunkGeneratorReply);
  } catch (err) {
    port.postMessage({ id, error: err instanceof Error ? err.stack ?? err.message : String(err) } satisfies ChunkGeneratorReply);
  }
};

const runNext = (): void => {
  const query = heights.shift();
  if (query) {
    answerHeight(query);
    setImmediate(runNext);
    return;
  }
  const next = queue.entries().next();
  if (next.done) {
    pumping = false;
    return;
  }
  const [id, job] = next.value;
  queue.delete(id);
  run(id, job);
  setImmediate(runNext);
};

port.on("message", (msg: ChunkGeneratorRequest) => {
  if (msg.t === "cancel") {
    queue.delete(msg.id);
    return;
  }
  if (msg.t === "height") heights.push(msg);
  else queue.set(msg.id, msg);
  if (!pumping) {
    pumping = true;
    setImmediate(runNext);
  }
});
