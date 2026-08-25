import React from "react";
import { TerrainNoiseParams } from "../../../utils/workers/vertexCompute";
import { Domain, Skybox, Terrain } from "../../components";
import { HomeRegion } from "./regions";
import { ClickToEnter } from "./regions/home/ClickToEnter";
import { CrtMonitor } from "./regions/home/CrtMonitor";
import { HomeGround } from "./regions/home/HomeGround";
import { HomeTitle } from "./regions/home/HomeTitle";

/** height 0 ⇒ contributes nothing — the home page is a perfectly flat plane. */
const FLAT_NOISE: TerrainNoiseParams = {
  type: "perlin",
  octaves: 1,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 0,
  scale: 1000,
};

/**
 * The home page domain (route "/"): a flat black plane with a lit white
 * wireframe grid, empty except for the CRT domain selector.
 *
 * terrain={false}: the streaming chunk terrain system is skipped — the ground
 * is HomeGround, ONE static plane + collider (the chunk system is overkill
 * for a perfectly flat world). The region/flat-noise config still commits so
 * the analytic height pipeline (Player backstop/respawn) reads height 0.
 * With zero ambient light everything renders pure black until the CrtMonitor
 * powers on after the player clicks in.
 */
export const HomeDomain = React.memo(() => (
  // Black background; flat ground at height 0, so spawn standing at the origin
  <Domain terrain={false} background="#000000" playerSpawn={[0, 0, 0]}>
    <Terrain seed="home" baseNoise={FLAT_NOISE} roadNoise={FLAT_NOISE} />
    {/* Pitch-black sky to match the page background */}
    <Skybox topColor="#000000" horizonColor="#000000" bottomColor="#000000" />

    <HomeRegion />

    {/* The ground: black fill + lit wireframe grid + flat collider */}
    <HomeGround />

    {/* Domain selector: a huge CRT that powers on ~1s after the player clicks
        in — scroll to flip through the 7 domains, click an unlocked page */}
    <CrtMonitor position={[0, 2.2, -36]} />

    {/* Floating title text */}
    <HomeTitle position={[0, 4, -10]} />
    {/* HTML overlay hint (not an in-world object) — click focuses the canvas */}
    <ClickToEnter />
  </Domain>
));
