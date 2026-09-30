import React from "react";
import { TerrainNoiseParams } from "../../../utils/workers/vertexCompute";
import { Domain, Regions, Skybox, Terrain } from "../../components";
import { ClickToEnter } from "./ClickToEnter";
import { CrtMonitor } from "./CrtMonitor";
import { HomeGround } from "./HomeGround";
import { HomeTitle } from "./HomeTitle";
import { HOME_REGIONS } from "./regions";
import { HomeRegion } from "./regions/home/region";

const FLAT_NOISE: TerrainNoiseParams = {
  type: "perlin",
  octaves: 1,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 0,
  scale: 1000,
};

/** The landing page (path "/"). The flat-noise config still commits so the
 *  analytic height pipeline (Player backstop/respawn) reads height 0 — keep
 *  <Terrain> and the home region even though HomeGround is the ground. */
export const HomeDomain = React.memo(() => (
  <Domain terrain={false} background="#000000" playerSpawn={[0, 0, 0]}>
    {/* defaultProbability 0 (and no region probability) switches rivers OFF for the domain. */}
    <Terrain seed="home" baseNoise={FLAT_NOISE} roadNoise={FLAT_NOISE} river={{ halfWidth: 1, depth: 0, bank: 1, defaultProbability: 0 }} />
    <Skybox topColor="#000000" horizonColor="#000000" bottomColor="#000000" />

    <Regions specs={HOME_REGIONS} components={{ home: HomeRegion }} />

    <HomeGround />

    <CrtMonitor position={[0, 2.2, -36]} />

    <HomeTitle position={[0, 4, -10]} />
    <ClickToEnter />
  </Domain>
));
