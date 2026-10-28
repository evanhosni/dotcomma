import type { TerrainNoiseParams } from "../../../utils/workers/types";
import { Biome, Domain, Region, Skybox, Terrain } from "../../components";
import { ClickToEnter } from "./ClickToEnter";
import { CrtMonitor } from "./CrtMonitor";
import { HomeGround } from "./HomeGround";
import { HomeTitle } from "./HomeTitle";

const FLAT: TerrainNoiseParams = { type: "perlin", octaves: 1, persistence: 1, lacunarity: 1, exponentiation: 1, height: 0, scale: 1000 };

/**
 * The landing page (path "/"). `terrain={false}`: HomeGround is the ground, and sets the terrain
 * gate itself. The flat config still commits, because the ANALYTIC height pipeline (the Player's
 * backstop and respawn) must read height 0 here — so the region and its one biome stay even though
 * neither draws anything. No <Rivers> anywhere in it, so it has none.
 */
export const HomeDomain = (
  <Domain terrain={false} background="#000000" playerSpawn={[0, 0, 0]}>
    <Terrain seed="home" baseNoise={FLAT} roadNoise={FLAT} />
    <Skybox topColor="#000000" horizonColor="#000000" bottomColor="#000000" />

    <Region id={0} name="home">
      <Biome id={4} name="wire" joinable />
    </Region>

    <HomeGround />
    <CrtMonitor position={[0, 2.2, -36]} />
    <HomeTitle position={[0, 4, -10]} />
    <ClickToEnter />
  </Domain>
);
