import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, after, describe, it } from "node:test";
import { build } from "esbuild";
import * as RAPIER from "@dimforge/rapier3d-compat";
import { computeVertexData, computeVertexDataRaw, freewayPointAt, getFlattenPoints, getNetwork, unwarp, warp } from "../../src/utils/workers/vertexCompute";
import { BUILDING_ATTRS } from "../../src/objects/actors/building/spec";
import { FREEWAY_LAMPS_SPEC, LAMP_COLLIDER_PARTS } from "../../src/objects/dressing/street-lamps/lampSpec";
import { DRESSING_COLLIDER_SPECS } from "../../src/objects/dressing/catalog";
import { runDressingEnumerator } from "../../src/objects/dressing/enumerators";
import { DRESSING_CHUNK_SIZE } from "../../src/objects/dressing/types";
import { createBuildingCollider } from "../src/game/physics/buildings.js";
import { createObstacleBodies } from "../src/game/physics/obstacles.js";
import { dressingChunkBounds, enumerateObstacles } from "../src/game/physics/obstaclePoints.js";
import { CITY_BIOME_ID } from "../../src/world/constants";
import { GRASS_BIOME } from "../../src/world/domains/overworld/regions/city/biomes/grass/spec";
import { PhysicsWorld } from "../src/game/physics/physicsWorld.js";
import { TICK_SECONDS } from "../src/game/tick.js";
import { Walker } from "../src/game/physics/walker.js";
import { GroundBody } from "../src/game/physics/groundBody.js";
import { findBiomePatch, findSlopeSpot, type SlopeSample } from "../src/cli/terrainScan.js";
import { chunkIndex, sampleChunkHeights, TERRAIN_SEGMENTS, vertexWorld } from "../src/game/physics/terrain.js";

const here = dirname(fileURLToPath(import.meta.url));
const CAPSULE = { radius: 0.5, height: 2 };
const SPEED = 5;

let pw: PhysicsWorld;
let patch: { x: number; z: number };
const held: string[] = [];

const settle = (w: Walker, ticks: number) => {
  for (let i = 0; i < ticks; i++) {
    w.step(TICK_SECONDS, 0, 0);
    pw.step();
  }
};
const push = (w: Walker, spot: SlopeSample, seconds: number) => {
  const p0 = w.position();
  const feet0 = w.feetY();
  let minFeet = feet0;
  for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) {
    w.step(TICK_SECONDS, spot.ux * SPEED, spot.uz * SPEED);
    pw.step();
    minFeet = Math.min(minFeet, w.feetY());
  }
  const p = w.position();
  return { along: (p.x - p0.x) * spot.ux + (p.z - p0.z) * spot.uz, dy: w.feetY() - feet0, minDrop: minFeet - feet0 };
};
const place = (spot: { x: number; z: number; height: number }) => {
  held.push(...pw.holdTerrainAround(spot.x, spot.z));
  const w = new Walker(pw, spot.x, spot.height + 0.1, spot.z, CAPSULE);
  settle(w, 5);
  return w;
};

describe("server physics", () => {
  before(async () => {
    pw = await PhysicsWorld.create();
    const p = findBiomePatch(GRASS_BIOME.id);
    assert.ok(p, "a grassland patch exists");
    patch = p;
  });
  after(() => {
    for (const k of held) pw.terrain.release(k);
    pw.free();
  });

  it("uses the client's Rapier — one copy, bundled from the root install", () => {
    // A server-local copy would be a second WASM instance with its own class identities.
    const pkg = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8"));
    assert.equal(pkg.dependencies["@dimforge/rapier3d-compat"], undefined, "no server-local Rapier");
    assert.ok(!existsSync(resolve(here, "../node_modules/@dimforge/rapier3d-compat")), "no server-local copy installed");
    const client = JSON.parse(readFileSync(resolve(here, "../../package-lock.json"), "utf8")).packages["node_modules/@dimforge/rapier3d-compat"];
    assert.ok(client, "the client resolves @dimforge/rapier3d-compat");
    assert.equal(RAPIER.version(), client.version, "the server runs the client's resolved version");
  });

  it("heightfield samples are the height function on the LOD1 grid, column-major", () => {
    const gx = chunkIndex(patch.x);
    const gz = chunkIndex(patch.z);
    const heights = sampleChunkHeights(gx, gz);
    const n = TERRAIN_SEGMENTS + 1;
    assert.equal(heights.length, n * n);
    for (const [ix, iz] of [[0, 0], [10, 50], [50, 10], [96, 96], [3, 90]]) {
      const { x, z } = vertexWorld(gx, gz, ix, iz);
      assert.equal(heights[ix * n + iz], Math.fround(computeVertexData(x, z).height), `vertex (${ix}, ${iz})`);
    }
    // A transposed layout would swap these.
    const a = vertexWorld(gx, gz, 10, 50);
    const b = vertexWorld(gx, gz, 50, 10);
    assert.notEqual(computeVertexData(a.x, a.z).height, computeVertexData(b.x, b.z).height);
  });

  it("terrain chunks are refcounted, built on the budgeted queue, and disposed on last release", () => {
    const before = pw.stats().colliders;
    const k1 = pw.terrain.request(1000, 1000);
    const k2 = pw.terrain.request(1000, 1000);
    assert.equal(k1, k2);
    assert.ok(!pw.terrain.isReady(k1), "not built until workFor() runs");
    pw.workFor(Infinity);
    assert.ok(pw.terrain.isReady(k1));
    assert.equal(pw.stats().colliders, before + 1);
    pw.terrain.release(k1);
    assert.ok(pw.terrain.has(1000, 1000), "still held once");
    pw.terrain.release(k2);
    assert.ok(!pw.terrain.has(1000, 1000));
    assert.equal(pw.stats().colliders, before);
    assert.ok(pw.stats().maxJobStepMs > 0, "job step time is recorded");
    const k3 = pw.terrain.request(2000, 2000);
    pw.terrain.release(k3);
    pw.workFor(Infinity);
    assert.equal(pw.stats().colliders, before, "abandoned build created nothing");
  });

  it("a chunk released while pending and requested again is still built", () => {
    // The queue dedupes by key: the first record's job must serve the second record.
    const before = pw.stats().colliders;
    pw.terrain.release(pw.terrain.request(1500, 1500));
    const k = pw.terrain.request(1500, 1500);
    pw.workFor(Infinity);
    assert.ok(pw.terrain.isReady(k), "re-requested chunk built");
    assert.equal(pw.stats().colliders, before + 1, "exactly once");
    pw.terrain.release(k);
    assert.equal(pw.stats().colliders, before);
  });

  it("the generation worker builds the in-place chunks bit for bit", async () => {
    const worker = await PhysicsWorld.create(undefined, { chunkGeneratorWorker: new URL("../src/game/physics/chunkGenerator.worker.ts", import.meta.url) });
    try {
      const gx = chunkIndex(patch.x);
      const gz = chunkIndex(patch.z);
      const city = findBiomePatch(CITY_BIOME_ID)!;
      const dx = Math.floor(city.x / DRESSING_CHUNK_SIZE);
      const dz = Math.floor(city.z / DRESSING_CHUNK_SIZE);
      const kt = worker.terrain.request(gx, gz);
      const kd = worker.dressing.request(dx, dz);
      worker.terrain.release(worker.terrain.request(gx + 7, gz)); // cancelled while pending
      worker.workFor(Infinity);
      assert.ok(!worker.terrain.isReady(kt), "nothing is sampled on the tick's thread");
      const deadline = Date.now() + 60_000;
      while (!(worker.terrain.isReady(kt) && worker.dressing.isReady(kd)) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
        worker.workFor(Infinity);
      }
      assert.ok(worker.terrain.isReady(kt) && worker.dressing.isReady(kd), "built from the worker's data");
      assert.ok(!worker.terrain.has(gx + 7, gz), "the cancelled chunk was never built");
      // The heightfield Rapier holds is the in-place sample, bit for bit.
      const field = worker.world.bodies.getAll().map((b) => b.collider(0)).find((c) => c.shape.type === RAPIER.ShapeType.HeightField)!;
      const held = (field.shape as RAPIER.Heightfield).heights;
      assert.deepEqual(Array.from(held), Array.from(sampleChunkHeights(gx, gz)), "heights identical");
      const expected = enumerateObstacles(dx, dz);
      assert.equal(worker.stats().colliders - 1, expected.reduce((n, p) => n + p.parts.length + (p.mesh ? 1 : 0), 0), "every dressing collider");
    } finally {
      worker.free();
    }
  });

  it("height queries are answered off the tick, bit for bit, and a body stands at its hint until then", async () => {
    const worker = await PhysicsWorld.create(undefined, { chunkGeneratorWorker: new URL("../src/game/physics/chunkGenerator.worker.ts", import.meta.url) });
    const until = async (done: () => boolean) => {
      const deadline = Date.now() + 60_000;
      while (!done() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
        worker.workFor(Infinity);
      }
    };
    try {
      const points = [patch, { x: patch.x + 37.3, z: patch.z - 12.9 }, { x: -2210.5, z: 3301.25 }];
      const answers: number[] = [];
      for (const p of points) worker.heightAt(p.x, p.z, (h) => answers.push(h));
      assert.equal(answers.length, 0, "never answered on the tick's thread");
      await until(() => answers.length === points.length);
      assert.deepEqual(answers, points.map((p) => computeVertexData(p.x, p.z).height), "the in-place heights");

      const ground = computeVertexData(patch.x, patch.z).height;
      const hint = ground + 7;
      const body = new GroundBody(worker, patch.x, patch.z, CAPSULE, hint);
      try {
        assert.equal(body.y, hint, "stands at the registration's hint");
        assert.ok(!body.ready, "not ready before its ground is answered");
        await until(() => {
          body.step(TICK_SECONDS, 0, 0, null);
          return body.ready;
        });
        assert.ok(body.ready, "ready once the ground is in and its chunks are built");
        const pose = body.resolvePose(TICK_SECONDS, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
        assert.ok(Math.abs(pose.y - ground) < 0.1, `placed on the ground (${(pose.y - ground).toFixed(3)}u)`);
      } finally {
        body.dispose();
      }
    } finally {
      worker.free();
    }
  });

  it("a dropped capsule lands on the terrain at the analytic height", () => {
    const flat = findSlopeSpot(patch.x, patch.z, { minDeg: 0, maxDeg: 6 });
    assert.ok(flat, "a near-flat vertex exists");
    held.push(...pw.holdTerrainAround(flat.x, flat.z));
    const w = new Walker(pw, flat.x, flat.height + 10, flat.z, CAPSULE);
    settle(w, 30);
    const gap = w.feetY() - flat.height;
    assert.ok(gap > -0.02 && gap < 0.3, `feet ${gap.toFixed(3)}u above the surface (contact offset 0.08 + snap)`);
    assert.ok(w.lastStep.walkableSupport, "resolver reports walkable support");
    assert.ok(pw.stats().steps > 0 && pw.stats().maxStepMs >= 0, "step time is recorded");
    // Off-vertex: heightfield triangle plane vs the smooth surface.
    w.placeFeet(flat.x + 1.7, flat.height + 5, flat.z + 2.2);
    settle(w, 30);
    const p = w.position();
    const h = computeVertexData(p.x, p.z).height;
    assert.ok(Math.abs(w.feetY() - h) < 0.6, `off-vertex gap ${(w.feetY() - h).toFixed(3)}u`);
    w.dispose();
  });

  it("walks up a gentle slope", () => {
    const gentle = findSlopeSpot(patch.x, patch.z, { minDeg: 12, maxDeg: 22 });
    assert.ok(gentle, "a 12–22° capsule-solid vertex exists");
    const w = place(gentle);
    const r = push(w, gentle, 3);
    const expected = SPEED * 3 * Math.cos(gentle.angle);
    assert.ok(r.along > expected * 0.7, `climbed ${r.along.toFixed(2)}u of ${expected.toFixed(2)}u`);
    assert.ok(r.dy > 1, `rose ${r.dy.toFixed(2)}u`);
    const h = computeVertexData(w.position().x, w.position().z).height;
    assert.ok(Math.abs(w.feetY() - h) < 0.6, "stayed on the surface while climbing");
    w.dispose();
  });

  it("slides down a steep slope instead of climbing it", () => {
    let steep = findSlopeSpot(patch.x, patch.z, { minDeg: 42, maxDeg: 90, radius: 900, offRoad: true });
    let synthetic = false;
    if (!steep) {
      // No ≥42° capsule-solid spot found: a synthetic 50° ramp so the test never silently passes.
      synthetic = true;
      const cx = 1e6;
      const cz = 1e6;
      const n = 21;
      const size = 100;
      const slope = Math.tan((50 * Math.PI) / 180);
      const heights = new Float32Array(n * n);
      for (let ix = 0; ix < n; ix++) for (let iz = 0; iz < n; iz++) heights[ix * n + iz] = (ix / (n - 1) - 0.5) * size * slope;
      const body = pw.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, 0, cz));
      pw.world.createCollider(RAPIER.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: size, y: 1, z: size }), body);
      steep = { x: cx, z: cz, height: 0, angle: (50 * Math.PI) / 180, ux: 1, uz: 0 };
    }
    const w = synthetic
      ? new Walker(pw, steep.x, steep.height + 0.1, steep.z, CAPSULE)
      : place(steep);
    if (synthetic) settle(w, 5);
    const r = push(w, steep, 3);
    const expected = SPEED * 3 * Math.cos(steep.angle);
    assert.ok(r.along < expected * 0.3, `uphill progress ${r.along.toFixed(2)}u vs ${expected.toFixed(2)}u if climbable (${synthetic ? "synthetic" : "real"} slope)`);
    assert.ok(r.minDrop < -1, `slid at least 1u down (lowest ${r.minDrop.toFixed(2)}u)`);
    w.dispose();
  });

  it("a building hull is sealed: a walker pushed at it stays outside", () => {
    // The flatten engine IS the placement — same seed rule as Building.tsx. The
    // origin's region is a seeded roll, so find a city patch first.
    const city = findBiomePatch(CITY_BIOME_ID, 200, 40000);
    assert.ok(city, "a city patch within scan range");
    const b = getFlattenPoints(city.x - 400, city.z - 400, city.x + 400, city.z + 400).find((p) => p.descId === "building");
    assert.ok(b, "a building placed in the city patch");
    held.push(...pw.holdTerrainAround(b.x, b.z));
    const before = pw.stats().colliders;
    const hull = createBuildingCollider(pw, BUILDING_ATTRS, b.x, b.y, b.z);
    assert.equal(pw.stats().colliders, before + 1, "one convex hull collider");
    // 30u east, pushing at the center for 8s (40u of intent).
    const sx = b.x + 30;
    const sz = b.z;
    const w = new Walker(pw, sx, computeVertexData(sx, sz).height + 0.1, sz, CAPSULE);
    settle(w, 5);
    let minDist = Infinity;
    for (let i = 0; i < Math.round(8 / TICK_SECONDS); i++) {
      w.step(TICK_SECONDS, -SPEED, 0);
      pw.step();
      const p = w.position();
      minDist = Math.min(minDist, Math.hypot(p.x - b.x, p.z - b.z));
    }
    assert.ok(minDist > 3, `never closer than ${minDist.toFixed(2)}u to the building center (footprint half-extents are ≥ ~5u)`);
    w.dispose();
    hull.dispose();
    assert.equal(pw.stats().colliders, before, "hull removed");
  });

  it("dressing obstacles: deterministic per chunk, one body per point with a cuboid per part (and its mesh)", () => {
    // The city is one region among several on a 3000u grid, so scan the dressing
    // chunks around the nearest city patch rather than the world origin.
    const city = findBiomePatch(CITY_BIOME_ID);
    assert.ok(city, "a city patch exists");
    const cx = Math.floor(city.x / DRESSING_CHUNK_SIZE);
    const cz = Math.floor(city.z / DRESSING_CHUNK_SIZE);
    let gx = cx;
    let gz = cz;
    let pts = enumerateObstacles(gx, gz);
    for (let r = 1; pts.length === 0 && r <= 3; r++) {
      for (let i = -r; i <= r && pts.length === 0; i++) for (let j = -r; j <= r && pts.length === 0; j++) {
        pts = enumerateObstacles(cx + i, cz + j);
        if (pts.length) (gx = cx + i), (gz = cz + j);
      }
    }
    assert.ok(pts.length > 0, "a city chunk has dressing obstacles");
    assert.ok(pts.some((p) => p.parts === LAMP_COLLIDER_PARTS), "street lamps among them");
    assert.deepEqual(enumerateObstacles(gx, gz), pts, "deterministic");
    const bounds = dressingChunkBounds(gx, gz);
    const fromCatalog = DRESSING_COLLIDER_SPECS.flatMap((spec) =>
      runDressingEnumerator(spec.enumerator, bounds, spec.placement).flatMap((p) => spec.bodiesOf(p).map((b) => ({ ...b, parts: b.parts ?? spec.colliderParts }))),
    );
    assert.deepEqual(pts, fromCatalog, "exactly the catalog's bodies — what the client components mount");
    const before = pw.stats();
    const bodies = createObstacleBodies(pw, pts);
    const after = pw.stats();
    assert.equal(after.bodies - before.bodies, pts.length);
    assert.equal(after.colliders - before.colliders, pts.reduce((n, p) => n + p.parts.length + (p.mesh ? 1 : 0), 0));
    for (const b of bodies) pw.removeBody(b);
    assert.equal(pw.stats().colliders, before.colliders);
  });

  it("freeway run lamps are obstacles too, straight from the catalog spec", () => {
    // A chunk on an inter-city run outside every city: the lamps the client's <FreewayLamps/> draws.
    let found: { gx: number; gz: number } | null = null;
    for (const run of getNetwork(warp(0, 0)).freeways) {
      for (let s = 60; s < run.length - 60 && !found; s += 32) {
        const w = freewayPointAt(run, s);
        const q = unwarp(w.x, w.z);
        if (computeVertexDataRaw(q.x, q.z).biomeId === CITY_BIOME_ID) continue;
        const gx = Math.floor(q.x / DRESSING_CHUNK_SIZE);
        const gz = Math.floor(q.z / DRESSING_CHUNK_SIZE);
        const bounds = dressingChunkBounds(gx, gz);
        if (runDressingEnumerator(FREEWAY_LAMPS_SPEC.enumerator, bounds, FREEWAY_LAMPS_SPEC.placement).length > 0) found = { gx, gz };
      }
      if (found) break;
    }
    assert.ok(found, "a run chunk with lamps");
    const { gx, gz } = found!;
    const bounds = dressingChunkBounds(gx, gz);
    const lamps = runDressingEnumerator(FREEWAY_LAMPS_SPEC.enumerator, bounds, FREEWAY_LAMPS_SPEC.placement);
    const obstacles = enumerateObstacles(gx, gz);
    for (const l of lamps) {
      const body = obstacles.find((o) => o.x === l.x && o.y === l.y && o.z === l.z);
      assert.ok(body, "every lamp is a server body");
      assert.equal(body!.yaw, l.yaw, "turned like the drawn post");
      assert.equal(body!.parts, LAMP_COLLIDER_PARTS, "the lamp's boxes");
    }
  });

  it("the server bundle imports no runtime three", async () => {
    const out = await build({
      entryPoints: [resolve(here, "../src/index.ts"), resolve(here, "../src/cli/physicsDemo.ts")],
      bundle: true,
      platform: "node",
      target: "node24",
      format: "esm",
      // Same externals as the build script. delaunator/noise-ts/seedrandom must stay
      // BUNDLED: as externals, Node's CJS interop handed `import Noise from "noise-ts"`
      // the exports object and the built server died at boot. three/react are external
      // so a leak shows up as an import statement instead of bundling a renderer.
      external: ["express", "ws", "three", "react"],
      write: false,
      outdir: resolve(here, "../dist-test-never-written"),
      logLevel: "silent",
    });
    for (const file of out.outputFiles) {
      assert.ok(!/from\s*["']three["']|require\(\s*["']three["']\s*\)|["']three\//.test(file.text), `${file.path} imports three`);
      assert.ok(!/from\s*["']react["']/.test(file.text), `${file.path} imports react`);
    }
    assert.ok(out.outputFiles.some((f) => /vertexCompute|computeVertexData/.test(f.text)), "the height pipeline is bundled in");
    assert.ok(out.outputFiles.some((f) => /RigidBodyDesc/.test(f.text)), "Rapier is bundled in, not external");
    for (const file of out.outputFiles) assert.ok(!/from\s*["']@dimforge\/rapier3d-compat["']/.test(file.text), `${file.path} leaves Rapier external`);
  });
});
