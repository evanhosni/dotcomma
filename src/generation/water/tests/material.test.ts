import { DOMAIN_CONFIGS } from "../../../world/domains";
import { biomeIdOf } from "../../../world/content/config";
import { initCompute } from "../..";
import { lakeBodyOf } from "../lakes/params";
import { WATER_DEFAULTS, bodyOf } from "../params";
import { writeWaterColors } from "../material";

/** Each body's water colours (material.ts writeWaterColors): its own, else its region's body of the same id,
 *  else the <Water> base's — whose defaults are the sheet's old constants — blended where two bodies meet. */

const CONFIG = DOMAIN_CONFIGS.overworld;
const colorsOf = (body: number, share = 1, body2 = -1) => {
  const shallow = new Float32Array(3);
  const deep = new Float32Array(4);
  writeWaterColors(body, share, body2, shallow, deep, 0);
  return { shallow: [...shallow], deep: [...deep] };
};
const f32 = (v: readonly number[]) => [...new Float32Array(v)];

describe("water colours", () => {
  beforeAll(() => initCompute(CONFIG));

  it("are the base's defaults, the sheet's old constants, where no body names its own", () => {
    expect(WATER_DEFAULTS.shallowColor).toEqual([0.22, 0.62, 0.62]);
    expect(WATER_DEFAULTS.deepColor).toEqual([0.12, 0.2, 0.28]);
    expect(WATER_DEFAULTS.deepDepth).toBe(14);
    const none = colorsOf(-1);
    expect(none.shallow).toEqual(f32(WATER_DEFAULTS.shallowColor));
    expect(none.deep).toEqual(f32([...WATER_DEFAULTS.deepColor, 14]));
    expect(colorsOf(lakeBodyOf(biomeIdOf(CONFIG, "lake")))).toEqual(none);
    expect(colorsOf(bodyOf(biomeIdOf(CONFIG, "grass"), "rivers"))).toEqual(none);
  });

  it("are a pond kind's own: a spring's teal, a hot spring's turquoise", () => {
    const spring = colorsOf(bodyOf(biomeIdOf(CONFIG, "oasis"), "pond:spring"));
    expect(spring.shallow).toEqual(f32([0x4f / 255, 0xb4 / 255, 0xa8 / 255]));
    expect(spring.deep[3]).toBe(6);
    const hot = colorsOf(bodyOf(biomeIdOf(CONFIG, "mountain"), "pond:hotSpring"));
    expect(hot.shallow).toEqual(f32([0x8f / 255, 0xdc / 255, 0xd2 / 255]));
  });

  it("blend by the vertex's share where two bodies meet", () => {
    const hot = bodyOf(biomeIdOf(CONFIG, "mountain"), "pond:hotSpring");
    const rivers = bodyOf(biomeIdOf(CONFIG, "mountain"), "rivers");
    const half = colorsOf(hot, 0.5, rivers);
    const a = colorsOf(hot);
    const b = colorsOf(rivers);
    for (let c = 0; c < 3; c++) expect(half.shallow[c]).toBeCloseTo((a.shallow[c] + b.shallow[c]) / 2, 5);
    expect(half.deep[3]).toBeCloseTo((a.deep[3] + b.deep[3]) / 2, 5);
  });
});
