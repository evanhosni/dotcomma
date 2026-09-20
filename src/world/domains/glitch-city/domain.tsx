import React from "react";
import { PostProcessing } from "../../../vfx/PostProcessing";
import { Domain, Material, Skybox, Terrain } from "../../components";
import { DayNightCycle } from "../../sky/DayNightCycle";
import { CityRegion, DesertRegion } from "./regions";

/** The main game domain (path /glitch-city). Region JSX order = voronoi order. */
export const GlitchCityDomain = React.memo(() => (
  <Domain>
    <Terrain seed="123" />
    <Material riverTexture="blue_mud.jpg" />
    <Skybox topColor="#4a90d9" horizonColor="#87ceeb" bottomColor="#666666" />
    <DayNightCycle />
    <PostProcessing quantization={0.025} />

    <CityRegion />
    <DesertRegion />
  </Domain>
));
