import { computeVertexData } from "../../../src/utils/workers/vertexCompute";
import { GRASS_BIOME_ID } from "../../../src/world/constants";
import { PhysicsWorld, PHYSICS_DT } from "../game/physics/physicsWorld.js";
import { Walker } from "../game/physics/walker.js";
import { deg, findBiomePatch, findSlopeSpot, slopeAt, type SlopeSample } from "./terrainScan.js";

/**
 * PHYSICS DEMO: `npm run physics:demo`
 *
 * Headless Rapier + real glitch-city terrain, stepped at the entity tick,
 * driven by the shared character resolver (the player's movement code).
 *   1. drops a capsule onto grassland — it must land at the analytic height
 *   2. walks it up a gentle slope — it must climb
 *   3. walks it up a steep (≥ 42°) slope — it must slide back down
 * A standalone check of the server's physics world — nothing in the game
 * depends on it.
 */

const CAPSULE = { radius: 0.5, height: 2 }; // the player's dimensions
const WALK_SPEED = 5; // BEEBLE_SPEED

const f = (n: number, d = 2) => n.toFixed(d).padStart(8);

const settle = (w: Walker, pw: PhysicsWorld, ticks: number) => {
  for (let i = 0; i < ticks; i++) {
    w.step(PHYSICS_DT, 0, 0);
    pw.step();
  }
};

const walk = (w: Walker, pw: PhysicsWorld, spot: SlopeSample, seconds: number, label: string) => {
  const start = w.position();
  const startFeet = w.feetY();
  let minFeet = startFeet;
  const ticks = Math.round(seconds / PHYSICS_DT);
  console.log(`\n${label}: ${deg(spot.angle)} slope at (${spot.x.toFixed(1)}, ${spot.z.toFixed(1)}), pushing uphill at ${WALK_SPEED} u/s for ${seconds}s`);
  console.log("   tick   uphill(u)    feetY   analytic   gap    grounded  groundAngle");
  for (let i = 1; i <= ticks; i++) {
    w.step(PHYSICS_DT, spot.ux * WALK_SPEED, spot.uz * WALK_SPEED);
    pw.step();
    const p = w.position();
    const feet = w.feetY();
    minFeet = Math.min(minFeet, feet);
    if (i % 5 === 0 || i === 1) {
      const along = (p.x - start.x) * spot.ux + (p.z - start.z) * spot.uz;
      const h = computeVertexData(p.x, p.z).height;
      console.log(`  ${String(i).padStart(4)} ${f(along)} ${f(feet)} ${f(h)} ${f(feet - h)}   ${w.last.walkableSupport ? "yes" : "no "}      ${deg(w.last.groundAngle)}`);
    }
  }
  const p = w.position();
  const along = (p.x - start.x) * spot.ux + (p.z - start.z) * spot.uz;
  return { along, dy: w.feetY() - startFeet, minDrop: minFeet - startFeet, expected: WALK_SPEED * seconds * Math.cos(spot.angle) };
};

const main = async () => {
  const pw = await PhysicsWorld.create(); // initializes the physics domain's height function
  console.log(`Rapier ready. dt = ${PHYSICS_DT}s (entity tick)`);

  let t0 = performance.now();
  const patch = findBiomePatch(GRASS_BIOME_ID);
  if (!patch) throw new Error("no grassland patch found");
  console.log(`grassland patch at (${patch.x}, ${patch.z}) — found in ${(performance.now() - t0).toFixed(0)}ms`);

  t0 = performance.now();
  const flat = findSlopeSpot(patch.x, patch.z, { minDeg: 0, maxDeg: 4 });
  const gentle = findSlopeSpot(patch.x, patch.z, { minDeg: 12, maxDeg: 22 });
  const steep = findSlopeSpot(patch.x, patch.z, { minDeg: 42, maxDeg: 90, radius: 900 });
  console.log(
    `spots scanned in ${(performance.now() - t0).toFixed(0)}ms: flat ${flat ? deg(flat.angle) : "none"}, gentle ${gentle ? deg(gentle.angle) : "none"}, steep ${steep ? deg(steep.angle) : "NONE"}`,
  );
  if (!flat || !gentle) throw new Error("scan failed");

  // ── 1. drop ──────────────────────────────────────────────────────────────
  const held: string[] = [];
  for (const s of [flat, gentle, steep]) if (s) held.push(...pw.holdTerrainAround(s.x, s.z));
  let st = pw.stats();
  console.log(`\nterrain: ${st.terrain.built} LOD1 chunks held, slowest job step ${st.maxJobStepMs.toFixed(1)}ms, colliders ${st.colliders}`);

  const dropFrom = 10;
  const w = new Walker(pw, flat.x, flat.height + dropFrom, flat.z, CAPSULE);
  console.log(`\nDROP: capsule feet at ${(flat.height + dropFrom).toFixed(2)} over ground ${flat.height.toFixed(2)} at (${flat.x.toFixed(1)}, ${flat.z.toFixed(1)})`);
  console.log("   tick    feetY   analytic    gap    vy      grounded  step(ms)");
  for (let i = 1; i <= 25; i++) {
    w.step(PHYSICS_DT, 0, 0);
    const ms = pw.step();
    const feet = w.feetY();
    console.log(`  ${String(i).padStart(4)} ${f(feet)} ${f(flat.height)} ${f(feet - flat.height)} ${f(w.character.state.vy, 1)}   ${w.last.walkableSupport ? "yes" : "no "}     ${ms.toFixed(3)}`);
  }
  const landGap = w.feetY() - flat.height;
  console.log(`→ landed ${landGap.toFixed(3)}u above the analytic surface (contact offset 0.08 expected)`);

  // ── 2. gentle slope ──────────────────────────────────────────────────────
  w.placeFeet(gentle.x, gentle.height + 0.1, gentle.z);
  settle(w, pw, 5);
  const g = walk(w, pw, gentle, 4, "GENTLE");
  console.log(`→ climbed ${g.along.toFixed(2)}u uphill of ${g.expected.toFixed(2)}u expected, rose ${g.dy.toFixed(2)}u`);

  // ── 3. steep slope ───────────────────────────────────────────────────────
  if (steep) {
    w.placeFeet(steep.x, steep.height + 0.1, steep.z);
    settle(w, pw, 5);
    const s = walk(w, pw, steep, 4, "STEEP");
    console.log(`→ net uphill ${s.along.toFixed(2)}u (would be ${s.expected.toFixed(2)}u if climbable), feet Δy ${s.dy.toFixed(2)}u, lowest ${s.minDrop.toFixed(2)}u below start`);
    const under = slopeAt(w.position().x, w.position().z);
    console.log(`  now standing on ${deg(under.angle)} ground`);
  } else {
    console.log("\nSTEEP: no ≥42° capsule-solid spot within 900u of the patch — widen the scan or pick another patch");
  }

  w.dispose();
  for (const k of held) pw.terrain.release(k);
  st = pw.stats();
  console.log(`\nstats: ${st.steps} steps, step last ${st.stepMs.toFixed(3)}ms / max ${st.maxStepMs.toFixed(3)}ms; chunks after release ${st.terrain.built}, colliders ${st.colliders}, bodies ${st.bodies}`);
  pw.free();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
