/**
 * ADDRESSES — every REGION cell and every BIOME cell of the overworld has a procedural
 * name that is a BIJECTIVE ENCODING of its grid coordinates, not a hash: nothing is
 * enumerated or stored, a name nobody has visited still decodes, and it decodes exactly.
 * Three-free; the server could run it.
 *
 *   /famous-sprawl                a region cell (travel lands on the biome cell under its site)
 *   /famous-sprawl/velvet-town    that region cell + a biome cell (travel lands on the biome cell's site)
 *   /snow                         the region of that TYPE nearest the world ORIGIN (stable for a shared link)
 *   /snow/mountain                …and the nearest biome of that type to that region cell's site
 *
 * A name is 2+ words: adjectives (256, shared) carrying 8 bits each, then ONE noun
 * from the place's THEME list (16 per theme — "lagoon" for a lake, "sprawl" for a city region)
 * carrying 4 bits. Cell (ix, iz) → zigzag → bit-interleave → n; the low 12 bits are
 * scrambled by a fixed odd multiplier (near-origin cells would otherwise all start
 * with word 0) → digits, minimum two words. Two words cover ±32 cells (region cells:
 * ±96k units; biome cells: ±16k units), three words ±512 cells, and so on.
 * FROZEN: the word lists, their ORDER, the theme assignment and SCRAMBLE are part of
 * every address ever written down — append-only, never reorder.
 */

import type { PointXZ } from "../../../utils/math/types";
import {
  findBiomeCell,
  findRegionCell,
  getBiomeCellSite,
  getPlaceInfo,
  getRegionCellSite,
  getRegions,
  getZoneOfBiomeCell,
  type GridCell,
  type PlaceInfo,
  type SerializedBiome,
  type SerializedRegion,
} from "../../../utils/workers/vertexCompute";

const ADJ_BITS = 8;
const ADJ_BASE = 1 << ADJ_BITS;
const NOUN_BITS = 4;
const NOUN_BASE = 1 << NOUN_BITS;
const MIN_WORDS = 2;
const SCRAMBLE_BITS = ADJ_BITS + NOUN_BITS; // the two-word range
const SCRAMBLE_MOD = 1 << SCRAMBLE_BITS;
/** Odd, so it is invertible mod 2^12. */
const SCRAMBLE = 0xa6d;

// prettier-ignore
export const ADJECTIVES: readonly string[] = [
  "amber","ashen","autumn","azure","bitter","black","blazing","blind","blue","bold","bone","brass","brave","bright","broken","bronze",
  "burnt","calm","candid","carved","cedar","chalk","chrome","cinder","civil","clay","clear","clever","cloud","cobalt","cold","copper",
  "coral","cosmic","cotton","crimson","crooked","crystal","curious","dappled","dark","dawn","deep","dim","distant","dizzy","double","drifting",
  "dry","dusk","dusty","early","eager","eastern","ebony","echoing","elder","electric","ember","empty","endless","even","fabled","faded",
  "faint","fallow","famous","far","feral","fierce","final","first","flat","fleet","floating","folded","forest","fossil","frozen","gentle",
  "giant","gilded","glass","gleaming","glowing","golden","granite","grave","gray","green","grim","half","hallow","hasty","hazel","heavy",
  "hidden","high","hollow","honest","honey","humble","hushed","idle","indigo","inner","iron","ivory","ivy","jade","jagged","jolly",
  "keen","kind","lantern","last","late","lazy","lead","lesser","light","lilac","little","lonely","long","lost","loud","low",
  "lucid","lunar","magenta","major","marble","mellow","merry","midnight","minor","misty","molten","mossy","muted","narrow","neon","nimble",
  "noble","north","oaken","obsidian","ochre","odd","old","olive","opal","open","orange","outer","pale","paper","patient","pearl",
  "pewter","plain","polar","proud","purple","quiet","quick","radiant","ragged","rapid","rare","raw","red","restless","rising","river",
  "rough","round","royal","ruby","rusty","sable","sacred","saffron","salt","sandy","scarlet","secret","shady","sharp","silent","silver",
  "simple","sleepy","slow","small","smoky","snowy","soft","solemn","southern","spare","spiral","spring","square","steady","steel","still",
  "stone","stormy","strange","summer","sunken","sunny","swift","tall","tame","tangled","tawny","tender","thin","tidal","timid","tiny",
  "topaz","twilight","twin","umber","upper","vague","vast","velvet","verdant","violet","vivid","wandering","warm","wary","weary","western",
  "white","wide","wild","willow","windy","winter","wise","woven","yellow","young","zealous","zesty","zinc","zonal","zigzag","zephyr",
];

/** 16 nouns per THEME, keyed by the region's / biome's `name` (a region and a biome may share a
 *  name — "city" is both). Every noun is unique across ALL lists, so a noun alone identifies its
 *  digit and decodes from any theme. */
// prettier-ignore
export const REGION_NOUNS: Readonly<Record<string, readonly string[]>> = {
  city:    ["metro","sprawl","district","borough","quarter","precinct","ward","zone","grid","circuit","junction","terminal","exchange","concourse","plaza","transit"],
  desert:   ["mesa","expanse","badlands","wastes","basin","hardpan","outback","flats","wilds","barrens","drylands","sands","emptiness","horizon","mirage","sunland"],
  snow:     ["frostlands","highlands","icefield","tundraland","whiteout","snowfield","glacierland","northreach","coldreach","permafrost","icereach","frostreach","snowreach","polarland","hoarlands","winterland"],
  ocean:    ["lakelands","shallows","waters","sound","gulf","strait","estuary","archipelago","seaboard","tidewater","backwater","waterway","inlets","fens","wetlands","lakeside"],
};
// prettier-ignore
export const BIOME_NOUNS: Readonly<Record<string, readonly string[]>> = {
  city:     ["ville","town","burg","heights","port","vale","gate","market","crossing","station","depot","yards","works","row","commons","terrace"],
  grass:    ["meadow","field","pasture","lea","sward","prairie","paddock","grassland","downs","glade","clearing","heath","steppe","savanna","range","fold"],
  dust:     ["dune","drift","trough","flatland","scar","ridge","sink","gully","wash","arroyo","playa","bluff","scarp","rise","knoll","sweep"],
  salt:     ["pan","salina","crust","glare","shelf","bed","table","plate","brine","glaze","sheet","pavement","floor","tract","span","level"],
  tundra:   ["moor","fell","bog","frost","waste","barren","reach","slope","bank","brae","ledge","lowland","mire","marsh","moss","stretch"],
  mountain: ["peak","summit","crag","spire","horn","tor","pinnacle","arete","massif","pass","saddle","col","cirque","aiguille","dome","crest"],
  lake:     ["lagoon","eddy","mere","tarn","pool","loch","lake","pond","shoal","cove","bay","lough","reservoir","firth","kettle","water"],
};
/** The theme of any region or biome without its own list. */
// prettier-ignore
export const GENERIC_NOUNS: readonly string[] = ["place","spot","corner","nook","patch","acre","parcel","holding","yard","plot","ground","land","stead","bound","lot","site"];

const nounThemeFor = (name: string, kind: "region" | "biome"): readonly string[] =>
  (kind === "region" ? REGION_NOUNS : BIOME_NOUNS)[name] ?? GENERIC_NOUNS;

if (ADJECTIVES.length !== ADJ_BASE) throw new Error(`address adjectives must have exactly ${ADJ_BASE} entries (${ADJECTIVES.length})`);
const ADJECTIVE_INDEX = new Map(ADJECTIVES.map((w, i) => [w, i] as const));
if (ADJECTIVE_INDEX.size !== ADJ_BASE) throw new Error("address adjectives contain duplicates");
const NOUN_THEMES: [string, readonly string[]][] = [
  ...Object.entries(REGION_NOUNS).map(([name, list]): [string, readonly string[]] => [`region "${name}"`, list]),
  ...Object.entries(BIOME_NOUNS).map(([name, list]): [string, readonly string[]] => [`biome "${name}"`, list]),
  ["generic", GENERIC_NOUNS],
];
const NOUN_INDEX = new Map<string, number>();
for (const [theme, list] of NOUN_THEMES) {
  if (list.length !== NOUN_BASE) throw new Error(`address noun theme ${theme} must have exactly ${NOUN_BASE} entries`);
  list.forEach((w, i) => {
    if (NOUN_INDEX.has(w)) throw new Error(`address noun "${w}" (theme ${theme}) is already in another list`);
    if (ADJECTIVE_INDEX.has(w)) throw new Error(`address noun "${w}" is also an adjective`);
    NOUN_INDEX.set(w, i);
  });
}

/** Modular inverse of SCRAMBLE mod 2^12 (Newton iteration on odd numbers). */
const SCRAMBLE_INVERSE = (() => {
  let x = SCRAMBLE;
  for (let i = 0; i < 5; i++) x = (x * (2 - SCRAMBLE * x)) % SCRAMBLE_MOD;
  return ((x % SCRAMBLE_MOD) + SCRAMBLE_MOD) % SCRAMBLE_MOD;
})();
const mulMod = (a: number, b: number): number => ((a % SCRAMBLE_MOD) * (b % SCRAMBLE_MOD)) % SCRAMBLE_MOD;

const zigzag = (v: number): number => (v >= 0 ? 2 * v : -2 * v - 1);
const unzigzag = (u: number): number => (u % 2 === 0 ? u / 2 : -(u + 1) / 2);

/** Bit-interleaves two unsigned integers (u → even bits, v → odd bits); exact below 2^26 each. */
const interleave = (u: number, v: number): number => {
  let n = 0;
  let bit = 1;
  for (let i = 0; i < 26; i++) {
    if (u & (1 << i)) n += bit;
    bit *= 2;
    if (v & (1 << i)) n += bit;
    bit *= 2;
  }
  return n;
};
const deinterleave = (n: number): [number, number] => {
  let u = 0;
  let v = 0;
  let rest = n;
  for (let i = 0; i < 26 && rest > 0; i++) {
    if (rest % 2 === 1) u |= 1 << i;
    rest = Math.floor(rest / 2);
    if (rest % 2 === 1) v |= 1 << i;
    rest = Math.floor(rest / 2);
  }
  return [u, v];
};

/** Cell → words (≥ 2: adjectives…, one themed noun). */
export const encodeCell = (cell: GridCell, theme: readonly string[]): string[] => {
  const n = interleave(zigzag(cell.ix), zigzag(cell.iz));
  const low = mulMod(n % SCRAMBLE_MOD, SCRAMBLE);
  let high = Math.floor(n / SCRAMBLE_MOD);
  const digits: number[] = [low >>> NOUN_BITS];
  while (high > 0) {
    digits.unshift(high % ADJ_BASE);
    high = Math.floor(high / ADJ_BASE);
  }
  while (digits.length < MIN_WORDS - 1) digits.unshift(0);
  return [...digits.map((d) => ADJECTIVES[d]), theme[low & (NOUN_BASE - 1)]];
};

/** Words → cell; null unless every word is in its list (adjectives…, a themed noun) and there are ≥ 2. */
export const decodeWords = (words: readonly string[]): GridCell | null => {
  if (words.length < MIN_WORDS) return null;
  const noun = NOUN_INDEX.get(words[words.length - 1]);
  if (noun === undefined) return null;
  const adjectives: number[] = [];
  for (const w of words.slice(0, -1)) {
    const d = ADJECTIVE_INDEX.get(w);
    if (d === undefined) return null;
    adjectives.push(d);
  }
  const lowScrambled = (adjectives[adjectives.length - 1] << NOUN_BITS) | noun;
  const low = mulMod(lowScrambled, SCRAMBLE_INVERSE);
  let high = 0;
  for (const d of adjectives.slice(0, -1)) high = high * ADJ_BASE + d;
  const [u, v] = deinterleave(high * SCRAMBLE_MOD + low);
  return { ix: unzigzag(u), iz: unzigzag(v) };
};

/** A parsed URL path: a region part and an optional biome part, each either a TYPE name
 *  (a region's / biome's `name`) or a word name. */
export interface Address {
  region: { type?: string; words?: string[] };
  biome?: { type?: string; words?: string[] };
}

const WORD_RE = /^[a-z]+$/;
const parsePart = (p: string): Address["region"] | null => {
  if (!WORD_RE.test(p.replace(/-/g, ""))) return null;
  if (p.includes("-")) {
    const words = p.split("-");
    return words.every((w) => WORD_RE.test(w)) ? { words } : null;
  }
  return { type: p };
};

/** "/famous-sprawl/velvet-town" | "/famous-sprawl" | "/snow" | "/snow/mountain" → Address; null for "/" or junk. */
export const parseAddressPath = (path: string): Address | null => {
  const parts = path.split("/").filter(Boolean).map((p) => decodeURIComponent(p).toLowerCase());
  if (parts.length === 0 || parts.length > 2) return null;
  const region = parsePart(parts[0]);
  if (!region) return null;
  if (parts.length === 1) return { region };
  const biome = parsePart(parts[1]);
  if (!biome) return null;
  return { region, biome };
};

export interface ResolvedAddress {
  regionCell: GridCell;
  region: SerializedRegion;
  biomeCell: GridCell;
  biome: SerializedBiome;
  /** Where travel lands: the biome cell's voronoi site, in real world space. */
  site: PointXZ;
  /** The canonical path for the address bar: region words / biome words. */
  path: string;
}

export const formatAddressPath = (regionWords: readonly string[], biomeWords: readonly string[]): string =>
  `/${regionWords.join("-")}/${biomeWords.join("-")}`;

/** The canonical path of a place: the REGION cell it stands in (named for the region under it)
 *  and the BIOME cell (named for the biome under it). */
export const pathForPlace = (place: Pick<PlaceInfo, "regionId" | "biomeId" | "regionCell" | "biomeCell">): string => {
  const regions = getRegions();
  const region = regions.find((r) => r.id === place.regionId);
  const biome = region?.biomes.find((b) => b.id === place.biomeId) ?? regions.flatMap((r) => r.biomes).find((b) => b.id === place.biomeId);
  return formatAddressPath(
    encodeCell(place.regionCell, nounThemeFor(region?.name ?? "generic", "region")),
    encodeCell(place.biomeCell, nounThemeFor(biome?.name ?? "generic", "biome")),
  );
};

/** Describes the place at a biome cell's site (names follow the ground there, see pathForPlace). */
export const describeBiomeCell = (biomeCell: GridCell): ResolvedAddress => {
  const site = getBiomeCellSite(biomeCell.ix, biomeCell.iz);
  const place = getPlaceInfo(site.x, site.z);
  const regions = getRegions();
  const region = regions.find((r) => r.id === place.regionId)!;
  const biome = region.biomes.find((b) => b.id === place.biomeId) ?? getZoneOfBiomeCell(biomeCell.ix, biomeCell.iz).biome;
  return { regionCell: place.regionCell, region, biomeCell, biome, site, path: pathForPlace(place) };
};

/** The address of a world position. */
export const addressOfPosition = (x: number, z: number): ResolvedAddress => describeBiomeCell(getPlaceInfo(x, z).biomeCell);

const originRegionCell = (): GridCell => getPlaceInfo(0, 0).regionCell;

/** Words decode; a type is that region's cell nearest the ORIGIN. */
const resolveRegionCell = (part: Address["region"], regions: SerializedRegion[]): GridCell | null => {
  if (part.words) return decodeWords(part.words);
  const region = regions.find((r) => r.name === part.type);
  return region ? findRegionCell(region.id, originRegionCell()) : null;
};

/** Words decode; a type is the nearest such biome to the region cell's site (in that region if it has
 *  one); none = the biome cell the region cell's site stands in. */
const resolveBiomeCell = (part: Address["biome"], regionCell: GridCell, regions: SerializedRegion[]): GridCell | null => {
  const regionSite = getRegionCellSite(regionCell.ix, regionCell.iz);
  const regionPlace = getPlaceInfo(regionSite.x, regionSite.z);
  if (part?.words) return decodeWords(part.words);
  if (!part?.type) return regionPlace.biomeCell;
  const biome = regions.flatMap((r) => r.biomes).find((b) => b.name === part.type);
  if (!biome) return null;
  return findBiomeCell(biome.id, regionPlace.biomeCell, regionPlace.regionId) ?? findBiomeCell(biome.id, regionPlace.biomeCell);
};

/** Resolves an address against the INITIALIZED compute module (main thread: after
 *  world/terrain/vertexData's ensureVertexCompute). Word names win over type names
 *  (the URL is then corrected to the canonical path). */
export const resolveAddress = (address: Address): ResolvedAddress | null => {
  const regions = getRegions();
  const regionCell = resolveRegionCell(address.region, regions);
  if (!regionCell) return null;
  const biomeCell = resolveBiomeCell(address.biome, regionCell, regions);
  if (!biomeCell) return null;
  return describeBiomeCell(biomeCell);
};
