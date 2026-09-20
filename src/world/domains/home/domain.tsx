import React from "react";
import { TerrainNoiseParams } from "../../../utils/workers/vertexCompute";
import { Domain, Skybox, Terrain } from "../../components";
import { HomeRegion } from "./regions";
import { ClickToEnter } from "./regions/home/ClickToEnter";
import { CrtMonitor } from "./regions/home/CrtMonitor";
import { HomeGround } from "./regions/home/HomeGround";
import { HomeTitle } from "./regions/home/HomeTitle";

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
 *  <Terrain>/<HomeRegion> even though HomeGround is the ground. */
export const HomeDomain = React.memo(() => (
  <Domain terrain={false} background="#000000" playerSpawn={[0, 0, 0]}>
    <Terrain seed="home" baseNoise={FLAT_NOISE} roadNoise={FLAT_NOISE} />
    <Skybox topColor="#000000" horizonColor="#000000" bottomColor="#000000" />

    <HomeRegion />

    <HomeGround />

    <CrtMonitor position={[0, 2.2, -36]} />

    <HomeTitle position={[0, 4, -10]} />
    <ClickToEnter />
  </Domain>
));
