import { DayNightLights } from "../../../lighting/day-night/DayNightLights";
import { WaterfallBoulders } from "../../../objects/dressing/waterfall-boulders/WaterfallBoulders";
import { WaterfallSplashes } from "../../../objects/particles/waterfall-splashes/WaterfallSplashes";
import { PostProcessing } from "../../../vfx/PostProcessing";
import { QUANTIZATION_GRID } from "../../constants";
import { Domain, Material, Skybox, Terrain, Water } from "../../components";
import { DayNightCycle } from "../../sky/day-night/DayNightCycle";
import { FastTravel } from "./FastTravel";
import { CityRegion } from "./regions/city/CityRegion";
import { DesertRegion } from "./regions/desert/DesertRegion";
import { OceanRegion } from "./regions/ocean/OceanRegion";
import { SnowRegion } from "./regions/snow/SnowRegion";

/**
 * THE GAME — one infinite map. Every URL path but "/" is an address inside it (world/domains/overworld/address/index.ts).
 *
 * Its <Region> children are in VORONOI order: the region roll is `floor(u × count)` over them, so
 * adding or reordering one re-rolls every region cell and MOVES EVERY ADDRESS anyone has linked to.
 */
export const OverworldDomain = (
  <Domain>
    <Terrain seed="123" defaultAdditionalHeight={20} />
    <Material riverTexture="potato_sack.jpg" />
    <Skybox />

    <DayNightLights />
    <DayNightCycle />
    <PostProcessing quantization={QUANTIZATION_GRID} />
    <FastTravel />
    {/* What every water shares, and what follows every water whatever body it is: every fall's boulders and spray. */}
    <Water>
      <WaterfallBoulders />
      <WaterfallSplashes />
    </Water>

    <CityRegion />
    <DesertRegion />
    <SnowRegion />
    <OceanRegion />
  </Domain>
);
