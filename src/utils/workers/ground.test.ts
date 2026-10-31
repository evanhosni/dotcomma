/** The ground word (ground.ts) on the real overworld: a city patch reads as its streets, sidewalks and
 *  its own ground — never a shared surface it does not have. */
import { DOMAIN_CONFIGS } from "../../world/domains";
import { groundAt } from "./ground";
import { initCompute } from "./vertexCompute";

beforeAll(() => initCompute(DOMAIN_CONFIGS.overworld));

describe("groundAt", () => {
  it("reads a city patch as road, sidewalk and the city's own ground", () => {
    const seen = new Map<string, number>();
    // The landing site of /city (the city cell nearest the origin).
    for (let dx = -150; dx <= 150; dx += 6) {
      for (let dz = -150; dz <= 150; dz += 6) {
        const g = groundAt(-5685 + dx, 2201 + dz);
        seen.set(g, (seen.get(g) ?? 0) + 1);
      }
    }
    expect(seen.get("road")).toBeGreaterThan(0);
    expect(seen.get("sidewalk")).toBeGreaterThan(0);
    expect(seen.get("city")).toBeGreaterThan(0);
    expect(seen.has("snow")).toBe(false);
  });
});
