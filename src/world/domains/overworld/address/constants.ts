const ADJ_BITS = 8;
export const ADJ_BASE = 1 << ADJ_BITS;
export const NOUN_BITS = 4;
export const NOUN_BASE = 1 << NOUN_BITS;
export const MIN_WORDS = 2;
const SCRAMBLE_BITS = ADJ_BITS + NOUN_BITS; // the two-word range
export const SCRAMBLE_MOD = 1 << SCRAMBLE_BITS;
/** Odd, so it is invertible mod 2^12. */
export const SCRAMBLE = 0xa6d;

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
  oasis:    ["wadi","palmgrove","waterhole","cistern","well","fount","seep","haven","palm","refuge","caravan","garden","orchard","verdure","qanat","date"],
  salt:     ["pan","salina","crust","glare","shelf","bed","table","plate","brine","glaze","sheet","pavement","floor","tract","span","level"],
  tundra:   ["moor","fell","bog","frost","waste","barren","reach","slope","bank","brae","ledge","lowland","mire","marsh","moss","stretch"],
  mountain: ["peak","summit","crag","spire","horn","tor","pinnacle","arete","massif","pass","saddle","col","cirque","aiguille","dome","crest"],
  lake:     ["lagoon","eddy","mere","tarn","pool","loch","lake","pond","shoal","cove","bay","lough","reservoir","firth","kettle","water"],
};
/** The theme of any region or biome without its own list. */
// prettier-ignore
export const GENERIC_NOUNS: readonly string[] = ["place","spot","corner","nook","patch","acre","parcel","holding","yard","plot","ground","land","stead","bound","lot","site"];
