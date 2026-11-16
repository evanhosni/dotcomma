import { DayNightLights } from "../../../lighting/DayNightLights";
import { WaterfallBoulders } from "../../../objects/dressing/waterfall-boulders";
import { WaterfallSplashes } from "../../../objects/particles/waterfall-splashes";
import { PostProcessing } from "../../../vfx/PostProcessing";
import { QUANTIZATION_GRID } from "../../constants";
import { Domain, Material, Skybox, Terrain, Water } from "../../components";
import { DayNightCycle } from "../../sky/DayNightCycle";
import { FastTravel } from "./FastTravel";
import { CityRegion } from "./regions/city";
import { DesertRegion } from "./regions/desert";
import { OceanRegion } from "./regions/ocean";
import { SnowRegion } from "./regions/snow";

/**
 * THE GAME — one infinite map. Every URL path but "/" is an address inside it (address.ts).
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
