import seedrandom from "seedrandom";
import { MASTER_SEED, seedRand } from "./_math";

// seedRand is a port of seedrandom's generator; every seed ever rolled must keep its value.
describe("seedRand", () => {
  it("is bit-identical to seedrandom", () => {
    let state = 12345;
    const rand = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
    const seeds: unknown[] = ["", 0, -1, 3.5, "0,0", "x".repeat(255), "y".repeat(256), "z".repeat(700), "é☃𝄞 unicode"];
    for (let i = 0; i < 20000; i++) {
      const x = (rand() - 0.5) * 2e5;
      const z = (rand() - 0.5) * 2e5;
      seeds.push(`${x},${z}`, `seed - ${i}X${-3 * i}`, i, `${Math.round(x)}_${Math.round(z)}`, "k".repeat(i % 600) + i);
    }
    for (const s of seeds) expect(seedRand(s)).toBe(seedrandom(`${s}${MASTER_SEED}`)());
  });
});
