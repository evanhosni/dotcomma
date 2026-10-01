import React from "react";
import { DayNightLights } from "../../../lighting/DayNightLights";
import { PostProcessing } from "../../../vfx/PostProcessing";
import { Domain, Material, Regions, Skybox, Terrain } from "../../components";
import { DayNightCycle } from "../../sky/DayNightCycle";
import { OVERWORLD_SEED } from "./config";
import { FastTravel } from "./FastTravel";
import { OVERWORLD_REGIONS } from "./regions";
import { CityRegion } from "./regions/city/region";
import { DesertRegion } from "./regions/desert/region";
import { OceanRegion } from "./regions/ocean/region";
import { SnowRegion } from "./regions/snow/region";

/** THE game — one infinite map of regions (every path but "/" is an address inside it,
 *  see address.ts), rendered from OVERWORLD_REGIONS — the list config.ts builds the server's copy from. */
export const OverworldDomain = React.memo(() => (
  <Domain>
    <DayNightLights />
    <Terrain seed={OVERWORLD_SEED} />
    <Material riverTexture="potato_sack.jpg" />
    <Skybox topColor="#4a90d9" horizonColor="#87ceeb" bottomColor="#666666" />
    <DayNightCycle />
    <PostProcessing quantization={0.025} />
    <FastTravel />
    <Regions specs={OVERWORLD_REGIONS} components={{ city: CityRegion, desert: DesertRegion, snow: SnowRegion, ocean: OceanRegion }} />
  </Domain>
));
