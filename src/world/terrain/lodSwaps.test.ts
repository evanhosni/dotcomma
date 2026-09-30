import { CHUNK_SIZE, LODLevel } from "./lodConfig";
import { computeDesiredChunks, DesiredChunks } from "./lodQuadtree";
import { FADE_OPAQUE_HI, LOD_FADE_SECONDS, LodSwapper, SwapChunk, SwapHooks } from "./lodSwaps";

/**
 * Simulated walks through the LOD scheduler, mirroring TerrainRenderer's frame: tick the fades
 * (useFrame), then the update pass (desired set after 8u of travel, prune, queue new chunks,
 * processSwaps, a random number of builds). Every frame checks, per 420u cell (every chunk is a
 * union of whole cells, so one sample per cell is exact):
 * - the drawn chunks' dither ranges PARTITION [0, 1) or the cell is empty — never a partial
 *   (hole) or an overlap (double surface);
 * - a cell covered last frame is still covered while the desired set still reaches it.
 * After each walk the camera parks and the scheduler must settle: no fades left, the chunk set is
 * exactly the desired set, every chunk opaque, nothing leaked.
 */

interface SimChunk extends SwapChunk {
  lod: LODLevel;
  dead: boolean;
}

const CELL = CHUNK_SIZE;
const DESIRED_MOVE_EPS_SQ = 64;

const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

class Sim {
  chunks = new Map<string, SimChunk>();
  swapper = new LodSwapper<SimChunk>();
  queue: SimChunk[] = [];
  desired: DesiredChunks = {};
  desiredCells = new Set<number>();
  atX = Infinity;
  atZ = Infinity;
  dirty = true;
  created = 0;
  freed = 0;
  covered = new Set<number>();
  fadeFrames = 0;
  maxFading = 0;
  hooks: SwapHooks<SimChunk>;

  constructor(readonly random: () => number) {
    this.hooks = {
      isDesired: (key) => this.desired[key] !== undefined,
      destroy: (c) => this.destroy(c),
      redraw: (c) => {
        if (c.dead) throw new Error(`redraw of destroyed ${c.key}`);
        if (c.drawn && !c.built) throw new Error(`drew unbuilt ${c.key}`);
      },
    };
  }

  destroy(c: SimChunk): void {
    if (c.dead) throw new Error(`double destroy ${c.key}`);
    if (c.transition) throw new Error(`destroyed ${c.key} mid-fade`);
    c.dead = true;
    this.chunks.delete(c.key);
    this.freed++;
  }

  frame(x: number, z: number, dt: number, builds: number): void {
    this.swapper.tick(dt, this.hooks);
    const mdx = x - this.atX;
    const mdz = z - this.atZ;
    const moved = mdx * mdx + mdz * mdz > DESIRED_MOVE_EPS_SQ;
    if (moved || this.dirty) {
      if (moved) {
        this.desired = computeDesiredChunks(x, z);
        this.atX = x;
        this.atZ = z;
        this.desiredCells.clear();
        for (const key in this.desired) {
          const { position, lod } = this.desired[key];
          forCells(position[0], position[1], lod.chunkSize, (k) => this.desiredCells.add(k));
        }
      }
      const isDesired = this.hooks.isDesired;
      this.swapper.prune(this.chunks.values(), isDesired, null, this.hooks.destroy);
      for (const key in this.desired) {
        if (this.chunks.has(key)) continue;
        const { position, lod } = this.desired[key];
        const c: SimChunk = { key, offset: { x: position[0], z: position[1] }, lod, built: false, drawn: false, transition: null, fadeLo: 0, fadeHi: FADE_OPAQUE_HI, dead: false };
        this.chunks.set(key, c);
        this.queue.push(c);
        this.created++;
      }
      this.swapper.processSwaps(this.chunks.values(), this.hooks);
      this.queue = this.queue.filter((c) => !c.dead);
      this.queue.sort((a, b) => b.lod.level - a.lod.level || (b.offset.x - x) ** 2 + (b.offset.z - z) ** 2 - ((a.offset.x - x) ** 2 + (a.offset.z - z) ** 2));
      let built = 0;
      for (; built < builds && this.queue.length > 0; built++) this.queue.pop()!.built = true;
      this.dirty = built > 0 || this.queue.length > 0 || this.swapper.busy || this.swapper.stale.size > 0;
    }
    this.check();
  }

  check(): void {
    const cells = new Map<number, [number, number][]>();
    let fading = 0;
    for (const c of this.chunks.values()) {
      if (!c.drawn) continue;
      if (!c.built) throw new Error(`drawn unbuilt ${c.key}`);
      if (c.transition) {
        fading++;
        if (!this.swapper.transitions.has(c.transition as any)) throw new Error(`${c.key} in a finished fade`);
      } else if (c.fadeLo !== 0 || c.fadeHi !== FADE_OPAQUE_HI) throw new Error(`${c.key} opaque with range ${c.fadeLo}..${c.fadeHi}`);
      if (c.fadeLo >= c.fadeHi) continue;
      forCells(c.offset.x, c.offset.z, c.lod.chunkSize, (k) => {
        const list = cells.get(k);
        if (list) list.push([c.fadeLo, c.fadeHi]);
        else cells.set(k, [[c.fadeLo, c.fadeHi]]);
      });
    }
    if (fading > 0) this.fadeFrames++;
    this.maxFading = Math.max(this.maxFading, fading);
    const now = new Set<number>();
    for (const [k, ranges] of cells) {
      ranges.sort((a, b) => a[0] - b[0]);
      if (ranges[0][0] !== 0) throw new Error(`cell ${k}: coverage starts at ${ranges[0][0]} (hole)`);
      for (let i = 1; i < ranges.length; i++) {
        if (ranges[i][0] < ranges[i - 1][1]) throw new Error(`cell ${k}: ranges overlap ${JSON.stringify(ranges)} (double surface)`);
        if (ranges[i][0] > ranges[i - 1][1]) throw new Error(`cell ${k}: gap ${JSON.stringify(ranges)} (hole)`);
      }
      if (ranges[ranges.length - 1][1] < 1) throw new Error(`cell ${k}: coverage ends at ${ranges[ranges.length - 1][1]} (hole)`);
      now.add(k);
    }
    for (const k of this.covered) {
      if (!now.has(k) && this.desiredCells.has(k)) throw new Error(`cell ${k} lost its ground`);
    }
    this.covered = now;
  }

  settle(x: number, z: number): void {
    for (let i = 0; i < 20000; i++) {
      this.frame(x, z, 1 / 60, 50);
      if (!this.dirty && this.queue.length === 0) break;
    }
    expect(this.swapper.transitions.size).toBe(0);
    expect(this.swapper.busy).toBe(false);
    expect(this.swapper.stale.size).toBe(0);
    expect([...this.chunks.keys()].sort()).toEqual(Object.keys(this.desired).sort());
    for (const c of this.chunks.values()) {
      expect(c.drawn && c.built && c.transition === null).toBe(true);
      expect([c.fadeLo, c.fadeHi]).toEqual([0, FADE_OPAQUE_HI]);
    }
    for (const k of this.desiredCells) expect(this.covered.has(k)).toBe(true);
    expect(this.created - this.freed).toBe(this.chunks.size);
  }
}

/** Cells keyed as one number (x-major); walks stay far inside ±50000 cells. */
const forCells = (cx: number, cz: number, size: number, fn: (key: number) => void): void => {
  const n = size / CELL;
  const x0 = Math.round((cx - size / 2) / CELL);
  const z0 = Math.round((cz - size / 2) / CELL);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) fn((x0 + i + 50000) * 100000 + (z0 + j + 50000));
};

type Path = (t: number) => [number, number];

const walk = (seed: number, path: Path, seconds: number, opts: { maxBuilds?: number; hitchChance?: number; stallChance?: number } = {}) => {
  const random = rng(seed);
  const sim = new Sim(random);
  const [x0, z0] = path(0);
  sim.settle(x0, z0);
  const { maxBuilds = 3, hitchChance = 0.01, stallChance = 0.05 } = opts;
  let t = 0;
  let stall = 0;
  while (t < seconds) {
    const dt = random() < hitchChance ? 0.1 + random() * 0.5 : 1 / 60 + random() * 0.01;
    t += dt;
    if (stall <= 0 && random() < stallChance) stall = Math.floor(random() * 30);
    const builds = stall-- > 0 ? 0 : Math.floor(random() * (maxBuilds + 1));
    const [x, z] = path(t);
    sim.frame(x, z, dt, builds);
  }
  const [x1, z1] = path(t);
  sim.settle(x1, z1);
  return sim;
};

describe("LOD cross-fade scheduler", () => {
  jest.setTimeout(120000);
  const origin: [number, number] = [1234.5, -987.25];

  it("sprints forward (45u/s) with no hole or double surface, fading every swap", () => {
    const sim = walk(1, (t) => [origin[0] + 45 * t, origin[1] + 7 * t], 60);
    expect(sim.fadeFrames).toBeGreaterThan(0);
  });

  it("fades both ways: forward, then back over the same ground", () => {
    walk(2, (t) => [origin[0] + 45 * (t < 20 ? t : 40 - t), origin[1]], 40);
  });

  it("reverses mid-fade: oscillating across a LOD1 ring edge faster than a fade", () => {
    const period = LOD_FADE_SECONDS * 0.8;
    walk(3, (t) => [210 + 420 + 60 * Math.sin((2 * Math.PI * t) / period), 30], 20, { maxBuilds: 6, stallChance: 0.01 });
  });

  it("outruns generation (300u/s, then 3000u/s) with stalls and hitches", () => {
    walk(4, (t) => [origin[0] + 300 * t, origin[1] - 120 * t], 30, { maxBuilds: 2, stallChance: 0.1, hitchChance: 0.05 });
    walk(5, (t) => [origin[0] + 3000 * t, origin[1] + 1000 * t], 10, { maxBuilds: 1, stallChance: 0.2 });
  });

  it("random walks with sudden reversals and speed changes", () => {
    for (let seed = 10; seed < 14; seed++) {
      const r = rng(seed);
      const legs: [number, number, number][] = [];
      for (let i = 0; i < 30; i++) legs.push([(r() - 0.5) * 600, (r() - 0.5) * 600, 0.2 + r() * 2]);
      const path: Path = (t) => {
        let x = origin[0];
        let z = origin[1];
        for (const [vx, vz, d] of legs) {
          const s = Math.min(t, d);
          x += vx * s;
          z += vz * s;
          t -= s;
          if (t <= 0) break;
        }
        return [x, z];
      };
      walk(seed, path, legs.reduce((a, l) => a + l[2], 0), { maxBuilds: 1 + (seed % 4) });
    }
  });

  it("fast travel: a far jump and a near one mid-walk", () => {
    walk(20, (t) => (t < 5 ? [origin[0] + 45 * t, origin[1]] : t < 12 ? [origin[0] + 25000, origin[1] - 9000] : [origin[0] + 25000 + 5000, origin[1] - 9000 + 45 * (t - 12)]), 20);
  });
});
