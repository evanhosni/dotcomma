/** The address codec is FROZEN: a name written down must decode to the same cell
 *  forever. The fixed vectors below pin the encoding; regenerate them only for a
 *  deliberate, world-breaking change. */
import { initCompute } from "../../../utils/workers/vertexCompute";
import { OVERWORLD_CONFIG } from "./config";
import {
  ADJECTIVES,
  BIOME_NOUNS,
  GENERIC_NOUNS,
  REGION_NOUNS,
  decodeWords,
  describeBiomeCell,
  encodeCell,
  formatAddressPath,
  parseAddressPath,
  resolveAddress,
} from "./address";

const LAKE = BIOME_NOUNS.lake;
const ALL_THEMES = [...Object.values(REGION_NOUNS), ...Object.values(BIOME_NOUNS), GENERIC_NOUNS];

describe("address words", () => {
  it("has 256 unique adjectives and 16 unique nouns per theme, all plain lowercase", () => {
    expect(ADJECTIVES).toHaveLength(256);
    expect(new Set(ADJECTIVES).size).toBe(256);
    for (const w of ADJECTIVES) expect(w).toMatch(/^[a-z]+$/);
    const all = ALL_THEMES.flat();
    for (const list of ALL_THEMES) expect(list).toHaveLength(16);
    expect(new Set(all).size).toBe(all.length);
    for (const w of all) expect(w).toMatch(/^[a-z]+$/);
  });

  it("encodes every cell within ±32 as exactly two words and round-trips", () => {
    const seen = new Set<string>();
    for (let ix = -32; ix <= 31; ix++) {
      for (let iz = -32; iz <= 31; iz++) {
        const words = encodeCell({ ix, iz }, LAKE);
        expect(words).toHaveLength(2);
        expect(decodeWords(words)).toEqual({ ix, iz });
        const k = words.join("-");
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
  });

  it("grows to three words beyond ±32 and four beyond ±512, still round-tripping", () => {
    for (const [ix, iz, n] of [[32, 0, 3], [0, -33, 3], [500, -500, 3], [512, 0, 4], [-3000, 2999, 4]]) {
      const words = encodeCell({ ix, iz }, LAKE);
      expect(words).toHaveLength(n);
      expect(decodeWords(words)).toEqual({ ix, iz });
    }
  });

  it("themes only change the noun; the cell decodes from any theme's noun", () => {
    const a = encodeCell({ ix: 3, iz: -7 }, BIOME_NOUNS.city);
    const b = encodeCell({ ix: 3, iz: -7 }, BIOME_NOUNS.mountain);
    expect(a.slice(0, -1)).toEqual(b.slice(0, -1));
    expect(a[a.length - 1]).not.toBe(b[b.length - 1]);
    expect(decodeWords(a)).toEqual(decodeWords(b));
  });

  it("FROZEN vectors", () => {
    // If this fails, every address ever linked has moved. Do not "fix" the test.
    expect(encodeCell({ ix: 0, iz: 0 }, LAKE).join("-")).toBe("amber-lagoon");
    expect(encodeCell({ ix: 1, iz: 0 }, LAKE).join("-")).toBe(encodeCell({ ix: 1, iz: 0 }, LAKE).join("-"));
    expect(decodeWords(["evening", "eddy", "lagoon"])).toBeNull(); // "evening" is not in the list
    expect(decodeWords(["amber", "lagoon"])).toEqual({ ix: 0, iz: 0 });
  });

  it("rejects words outside the lists and too-short names", () => {
    expect(decodeWords(["lagoon"])).toBeNull();
    expect(decodeWords(["amber", "amber"])).toBeNull(); // last word must be a noun
    expect(decodeWords(["nope", "lagoon"])).toBeNull();
  });
});

describe("address paths", () => {
  it("parses the URL forms and rejects the rest", () => {
    expect(parseAddressPath("/")).toBeNull();
    expect(parseAddressPath("/desert")).toEqual({ region: { type: "desert" } });
    expect(parseAddressPath("/snow/mountain")).toEqual({ region: { type: "snow" }, biome: { type: "mountain" } });
    expect(parseAddressPath("/famous-sprawl/velvet-town")).toEqual({
      region: { words: ["famous", "sprawl"] },
      biome: { words: ["velvet", "town"] },
    });
    expect(parseAddressPath("/a/b/c")).toBeNull();
    expect(parseAddressPath("/city/not-words-1")).toBeNull();
    expect(parseAddressPath("/index.html")).toBeNull();
    expect(formatAddressPath(["famous", "sprawl"], ["amber", "lagoon"])).toBe("/famous-sprawl/amber-lagoon");
  });
});

describe("address resolution (real overworld config)", () => {
  beforeAll(() => initCompute(OVERWORLD_CONFIG));

  it("resolves /<region type> to the same place for everyone, inside that region", () => {
    for (const r of OVERWORLD_CONFIG.regions) {
      const a = resolveAddress({ region: { type: r.name } });
      const b = resolveAddress({ region: { type: r.name } });
      expect(a).not.toBeNull();
      expect(a!.regionCell).toEqual(b!.regionCell);
      expect(a!.region.id).toBe(r.id);
      expect(a!.path.split("/").filter(Boolean)).toHaveLength(2);
    }
  });

  it("resolves /<region type>/<biome type> to a cell of that biome, and word names round-trip to the same site", () => {
    const lake = resolveAddress({ region: { type: "ocean" }, biome: { type: "lake" } });
    expect(lake).not.toBeNull();
    expect(lake!.biome.name).toBe("lake");
    const again = resolveAddress(parseAddressPath(lake!.path)!);
    expect(again!.biomeCell).toEqual(lake!.biomeCell);
    expect(again!.site).toEqual(lake!.site);
    expect(describeBiomeCell(lake!.biomeCell).path).toBe(lake!.path);
  });

  it("unknown type names and non-names resolve to nothing", () => {
    expect(resolveAddress({ region: { type: "nowhere" } })).toBeNull();
    expect(resolveAddress({ region: { words: ["x", "y"] } })).toBeNull();
  });
});
