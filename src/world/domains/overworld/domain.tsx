import { QUANTIZATION_GRID } from "../../constants";
import React from "react";
import { DayNightLights } from "../../../lighting/DayNightLights";
import { Dressing } from "../../../objects/dressing/Dressing";
import { LakeBubbles } from "../../../objects/dressing/particles/LakeBubbles";
import { RiverSplashes } from "../../../objects/dressing/particles/RiverSplashes";
import { Rocks } from "../../../objects/dressing/rocks/Rocks";
import { SnowDrift } from "../../../objects/dressing/snow-drift/SnowDrift";
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
    <PostProcessing quantization={QUANTIZATION_GRID} />
    <FastTravel />
    <Regions specs={OVERWORLD_REGIONS} components={{ city: CityRegion, desert: DesertRegion, snow: SnowRegion, ocean: OceanRegion }} />
    {/* FLAG-DRIVEN dressing, mounted ONCE: each draws every biome whose spec sets its flag (snow, rocks) or
        stands on any river or water (spray, bubbles). The tunnels (<Caves/>, <Sewers/>) are mounted in the
        biomes that hold them: their chunks are built per biome. Biome-specific features stay in the biomes. */}
    <Dressing>
      <SnowDrift />
      <Rocks />
      <RiverSplashes />
      <LakeBubbles />
    </Dressing>
  </Domain>
));
