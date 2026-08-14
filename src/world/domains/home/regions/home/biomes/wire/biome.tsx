import { Biome } from "../../../../../../components";

export const WIRE_BIOME_ID = 4;

/** Home-page biome: perfectly flat — no biome-level <Terrain noise>, so its
 *  height contribution is 0 (HomeDomain also zeroes the world base/road
 *  noise). It exists only so the world config commits and the analytic
 *  height pipeline (Player backstop/respawn) has a biome to resolve; nothing
 *  is rendered from it — HomeDomain skips the chunk terrain entirely
 *  (terrain={false}) and draws its ground as the single HomeGround plane. */
export const WireBiome = () => <Biome name="wire" id={WIRE_BIOME_ID} joinable blendable />;
