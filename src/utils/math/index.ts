/** The ONE string that defines "the same world": every deterministic roll goes through seedRand. */
export const MASTER_SEED = "mynamebierce";

// seedrandom's default generator (ARC4, RC4-drop[256], 52-bit doubles) on two reused byte arrays:
// bit-identical to `seedrandom(seed + MASTER_SEED)()` (_math.test.ts compares them) at ~2.3× the
// speed. The library allocates a generator, its closures and two 256-entry arrays per call and
// mixes every state into its global entropy pool, which made it the pipeline's largest self time
// (~20% of the terrain worker's startup ring).
const arc4S = new Uint8Array(256);
const arc4Key = new Uint8Array(256);
const TWO_POW_48 = 281474976710656;
const TWO_POW_52 = 4503599627370496;
const TWO_POW_53 = 9007199254740992;

export const seedRand = (seed: any): number => {
  const str = seed + MASTER_SEED;
  const len = str.length;
  const S = arc4S;
  const K = arc4Key;
  // The string smeared into a key of at most 256 bytes (seedrandom's mixkey).
  let smear = 0;
  for (let c = 0; c < len; c++) {
    const k = c & 255;
    if (c >= 256) smear ^= K[k] * 19;
    K[k] = 255 & (smear + str.charCodeAt(c));
  }
  if (len === 0) K[0] = 0;
  const keyLength = len === 0 ? 1 : Math.min(len, 256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let i = 0;
  let j = 0;
  for (; i < 256; i++) {
    const t = S[i];
    j = 255 & (j + K[i % keyLength] + t);
    S[i] = S[j];
    S[j] = t;
  }
  i = 0;
  j = 0;
  const next = (): number => {
    i = 255 & (i + 1);
    const t = S[i];
    j = 255 & (j + t);
    S[i] = S[j];
    S[j] = t;
    return S[255 & (S[i] + t)];
  };
  for (let c = 0; c < 256; c++) next();
  let n = 0;
  for (let c = 0; c < 6; c++) n = n * 256 + next();
  let d = TWO_POW_48;
  let x = 0;
  while (n < TWO_POW_52) {
    n = (n + x) * 256;
    d *= 256;
    x = next();
  }
  while (n >= TWO_POW_53) {
    n /= 2;
    d /= 2;
    x >>>= 1;
  }
  return (n + x) / d;
};

/** GLSL-semantics smoothstep: 0 below edge0, 1 above edge1, Hermite between. */
export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const clamp = (x: number, min: number, max: number): number => Math.min(Math.max(x, min), max);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** An angle (radians) wrapped into [-π, π]. */
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Distance from (px, pz) to the segment a→b on the horizontal plane. */
export const distanceToSegment = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
};
