import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, after, describe, it } from "node:test";
import { build } from "esbuild";
import * as RAPIER from "@dimforge/rapier3d-compat";
import { computeVertexData, getFlattenPoints } from "../../src/utils/workers/vertexCompute";
import { BUILDING_ATTRS } from "../../src/objects/actors/building/variants";
import { LAMP_COLLIDER_PARTS } from "../../src/objects/dressing/street-lamps/lampSpec";
import { createBuildingCollider } from "../src/game/physics/buildings.js";
import { createObstacleBodies, enumerateObstacles } from "../src/game/physics/obstacles.js";
import { GRASS_BIOME_ID } from "../../src/world/constants";
import { PhysicsWorld, PHYSICS_DT } from "../src/game/physics/world.js";
import { Walker } from "../src/game/physics/walker.js";
import { findBiomePatch, findSlopeSpot, type SlopeSample } from "../src/cli/terrainScan.js";
import { chunkIndex, sampleChunkHeights, TERRAIN_SEGMENTS, vertexWorld } from "../src/game/physics/terrain.js";

/**
 * Server physics: headless Rapier on the real terrain height function, the
 * shared character resolver, building hulls and dressing obstacles. Slope
 * spots are scanned from the actual glitch-city grassland at LOD1 vertex
 * resolution; if the scan finds no ≥ 42° capsule-solid spot the slide test
 * falls back to a synthetic 50° ramp so it never silently passes.
 */

const here = dirname(fileURLToPath(import.meta.url));
const CAPSULE = { radius: 0.5, height: 2 };
const SPEED = 5;

let pw: PhysicsWorld;
let patch: { x: number; z: number };
const held: string[] = [];

const settle = (w: Walker, ticks: number) => {
  for (let i = 0; i < ticks; i++) {
    w.step(PHYSICS_DT, 0, 0);
    pw.step();
  }
};
const push = (w: Walker, spot: SlopeSample, seconds: number) => {
  const p0 = w.position();
  const feet0 = w.feetY();
  let minFeet = feet0;
  for (let i = 0; i < Math.round(seconds / PHYSICS_DT); i++) {
    w.step(PHYSICS_DT, spot.ux * SPEED, spot.uz * SPEED);
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
    pw = await PhysicsWorld.create(); // initializes the glitch-city height function
    const p = findBiomePatch(GRASS_BIOME_ID);
    assert.ok(p, "a grassland patch exists");
    patch = p;
  });
  after(() => {
    for (const k of held) pw.terrain.release(k);
    pw.free();
  });

  it("uses the client's Rapier — one copy, bundled from the root install", () => {
    // The server declares NO Rapier dependency: esbuild bundles the root
    // install's @dimforge/rapier3d-compat (the one @react-three/rapier pulls
    // in) into the server, so the shared movement module and the client can
    // never disagree on package or version. A server-local copy would be a
    // second WASM instance with its own class identities.
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
    // Not symmetric: a transposed layout would swap these.
    const a = vertexWorld(gx, gz, 10, 50);
    const b = vertexWorld(gx, gz, 50, 10);
    assert.notEqual(computeVertexData(a.x, a.z).height, computeVertexData(b.x, b.z).height);
  });

  it("terrain chunks are refcounted, built on the budgeted queue, and disposed on last release", () => {
    const before = pw.stats().colliders;
    const k1 = pw.terrain.request(1000, 1000);
    const k2 = pw.terrain.request(1000, 1000);
    assert.equal(k1, k2);
    assert.ok(!pw.terrain.isReady(k1), "not built until work() runs");
    pw.work(Infinity);
    assert.ok(pw.terrain.isReady(k1));
    assert.equal(pw.stats().colliders, before + 1);
    pw.terrain.release(k1);
    assert.ok(pw.terrain.has(1000, 1000), "still held once");
    pw.terrain.release(k2);
    assert.ok(!pw.terrain.has(1000, 1000));
    assert.equal(pw.stats().colliders, before);
    assert.ok(pw.stats().maxJobStepMs > 0, "job step time is recorded");
    // A release while pending abandons the build.
    const k3 = pw.terrain.request(2000, 2000);
    pw.terrain.release(k3);
    pw.work(Infinity);
    assert.equal(pw.stats().colliders, before, "abandoned build created nothing");
  });

  it("a dropped capsule lands on the terrain at the analytic height", () => {
    const flat = findSlopeSpot(patch.x, patch.z, { minDeg: 0, maxDeg: 6 });
    assert.ok(flat, "a near-flat vertex exists");
    held.push(...pw.holdTerrainAround(flat.x, flat.z));
    const w = new Walker(pw, flat.x, flat.height + 10, flat.z, CAPSULE);
    settle(w, 30);
    const gap = w.feetY() - flat.height;
    assert.ok(gap > -0.02 && gap < 0.3, `feet ${gap.toFixed(3)}u above the surface (contact offset 0.08 + snap)`);
    assert.ok(w.last.walkableSupport, "resolver reports walkable support");
    assert.ok(pw.stats().steps > 0 && pw.stats().maxStepMs >= 0, "step time is recorded");
    // Off-vertex too: the heightfield triangle plane vs the smooth surface.
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
    let steep = findSlopeSpot(patch.x, patch.z, { minDeg: 42, maxDeg: 90, radius: 900 });
    let synthetic = false;
    if (!steep) {
      // Fallback: a synthetic 50° ramp far from any terrain chunk.
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
    // A real city building (the flatten engine IS the placement — same seed rule as Building.tsx).
    const b = getFlattenPoints(-400, -400, 400, 400).find((p) => p.descId === "building");
    assert.ok(b, "a building placed near the origin");
    held.push(...pw.holdTerrainAround(b.x, b.z));
    const before = pw.stats().colliders;
    const hull = createBuildingCollider(pw, { attrs: BUILDING_ATTRS }, b.x, b.y, b.z);
    assert.equal(pw.stats().colliders, before + 1, "one convex hull collider");
    // Approach from 30u east, pushing straight at the center for 8s (40u of intent).
    const sx = b.x + 30;
    const sz = b.z;
    const w = new Walker(pw, sx, computeVertexData(sx, sz).height + 0.1, sz, CAPSULE);
    settle(w, 5);
    let minDist = Infinity;
    for (let i = 0; i < Math.round(8 / PHYSICS_DT); i++) {
      w.step(PHYSICS_DT, -SPEED, 0);
      pw.step();
      const p = w.position();
      minDist = Math.min(minDist, Math.hypot(p.x - b.x, p.z - b.z));
    }
    assert.ok(minDist > 3, `never closer than ${minDist.toFixed(2)}u to the building center (footprint half-extents are ≥ ~5u)`);
    w.dispose();
    hull.dispose();
    assert.equal(pw.stats().colliders, before, "hull removed");
  });

  it("dressing obstacles: deterministic per chunk, one body per point with a cuboid per part", () => {
    // The origin is city; find a dressing chunk near it that actually has lamps.
    let gx = 0;
    let gz = 0;
    let pts = enumerateObstacles(gx, gz);
    for (let r = 1; pts.length === 0 && r <= 3; r++) {
      for (let i = -r; i <= r && pts.length === 0; i++) for (let j = -r; j <= r && pts.length === 0; j++) {
        pts = enumerateObstacles(i, j);
        if (pts.length) (gx = i), (gz = j);
      }
    }
    assert.ok(pts.length > 0, "a city chunk near the origin has dressing obstacles");
    assert.ok(pts.some((p) => p.parts === LAMP_COLLIDER_PARTS), "street lamps among them");
    assert.deepEqual(enumerateObstacles(gx, gz), pts, "deterministic");
    const before = pw.stats();
    const bodies = createObstacleBodies(pw, pts);
    const after = pw.stats();
    assert.equal(after.bodies - before.bodies, pts.length);
    assert.equal(after.colliders - before.colliders, pts.reduce((n, p) => n + p.parts.length, 0));
    for (const b of bodies) pw.removeBody(b);
    assert.equal(pw.stats().colliders, before.colliders);
  });

  it("the server bundle imports no runtime three", async () => {
    const out = await build({
      entryPoints: [resolve(here, "../src/index.ts"), resolve(here, "../src/cli/physicsDemo.ts")],
      bundle: true,
      platform: "node",
      target: "node24",
      format: "esm",
      // The build script's externals: runtime packages Node resolves itself.
      // Rapier, delaunator, noise-ts and seedrandom are BUNDLED from the root
      // install (Rapier: one copy shared with the client; the CJS ones: as
      // externals, Node's interop handed `import Noise from "noise-ts"` the
      // exports object and the built server died at boot).
      // three/react are external so a leak shows up as an import statement
      // below instead of silently bundling a renderer into the server.
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
