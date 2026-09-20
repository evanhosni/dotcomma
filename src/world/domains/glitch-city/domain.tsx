import React from "react";
import { PostProcessing } from "../../../vfx/PostProcessing";
import { Domain, Material, Skybox, Terrain } from "../../components";
import { DayNightCycle } from "../../sky/DayNightCycle";
import { GLITCH_CITY_SEED } from "./config";
import { CityRegion, DesertRegion } from "./regions";

/** The main game domain (path /glitch-city). Region JSX order = voronoi order — and config.ts, the
 *  Three-free description the server runs on, must list the same regions (dev warns when they differ). */
export const GlitchCityDomain = React.memo(() => (
  <Domain>
    <Terrain seed={GLITCH_CITY_SEED} />
    <Material riverTexture="blue_mud.jpg" />
    <Skybox topColor="#4a90d9" horizonColor="#87ceeb" bottomColor="#666666" />
    <DayNightCycle />
    <PostProcessing quantization={0.025} />

    <CityRegion />
    <DesertRegion />
  </Domain>
));
