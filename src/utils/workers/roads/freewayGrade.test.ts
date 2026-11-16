/** A run is LOWERED to the ground, never raised over it: its pavement never stands over the road-free
 *  ground (river walls included) and it never climbs steeper than 45°. Around (540, 22250), where a
 *  river's walls cut a mountain down by up to 150u everywhere but along the run, which stood on a ridge
 *  climbing at ~70°. */
import { DOMAIN_CONFIGS } from "../../../world/domains";
import { computeVertexData, groundUnderRoadAt, initCompute } from "../vertexCompute";

beforeAll(() => initCompute(DOMAIN_CONFIGS.overworld));

test("a run rides at or under its ground and climbs no steeper than 45°", () => {
  // The road's centerline, row by row: the point of least road field in each row.
  const centre: { x: number; z: number; y: number }[] = [];
  for (let z = 22000; z <= 22420; z += 6) {
    let best: { x: number; z: number; y: number; d: number } | null = null;
    for (let x = 400; x <= 700; x += 2) {
      const v = computeVertexData(x, z);
      if (v.distanceToRoadCenter < 1 && (!best || v.distanceToRoadCenter < best.d)) best = { x, z, y: v.height, d: v.distanceToRoadCenter };
    }
    if (best) centre.push(best);
  }
  expect(centre.length).toBeGreaterThan(50);
  let above = 0;
  let steep = 0;
  for (let i = 0; i < centre.length; i++) {
    const c = centre[i];
    const ground = groundUnderRoadAt(c.x, c.z);
    // (The curb dip and the 8u lattice between samples: well under a unit.)
    if (!Number.isNaN(ground) && c.y > ground + 1) above++;
    if (i > 0) {
      const p = centre[i - 1];
      const run = Math.hypot(c.x - p.x, c.z - p.z);
      // Row samples snap to a 2u column: the slope is judged over the step, with that snap's slack.
      if (Math.abs(c.y - p.y) > run + 2.5) steep++;
    }
  }
  expect({ above, steep }).toEqual({ above: 0, steep: 0 });
});
