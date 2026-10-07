/** The band policy's one guarantee: a chunk holds every blade the draw truncation asks for. */
import { foliageBandCovers, foliageBandFor, foliageBandToRequest, foliageDrawFraction } from "./foliageLod";

const RENDER_DISTANCES = [200, 500, 800];
const TOTALS = [1, 7, 4099, 32768];
const drawn = (total: number, dNear: number, r: number) => Math.ceil(total * foliageDrawFraction(dNear, r));
const heldBy = (total: number, band: number) => Math.min(total, Math.ceil(total * band));

test("a requested band holds what is drawn at the request distance and anywhere nearer it covers", () => {
  let short = 0;
  for (const r of RENDER_DISTANCES)
    for (let d = 0; d <= r * 1.3; d += 0.5) {
      const band = foliageBandToRequest(d, r);
      for (const total of TOTALS) {
        if (drawn(total, d, r) > heldBy(total, band)) short++;
        // Covered ⇒ nothing short from here down to 24u nearer (the widen margin).
        if (foliageBandCovers(band, d, r))
          for (let n = Math.max(0, d - 24); n <= d; n += 0.5) if (drawn(total, n, r) > heldBy(total, band)) short++;
      }
    }
  expect(short).toBe(0);
});

test("past the taper only the far band is requested, and widening always goes up", () => {
  expect(foliageBandFor(360, 500)).toBe(0.25);
  expect(foliageBandFor(200, 500)).toBe(1);
  for (let d = 0; d <= 650; d += 1) {
    if (!foliageBandCovers(0.25, d, 500)) expect(foliageBandToRequest(d, 500)).toBeGreaterThan(0.25);
  }
});
