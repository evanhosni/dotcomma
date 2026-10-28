import { DayNightLights } from "../../../lighting/DayNightLights";
import { RiverSplashes } from "../../../objects/particles/river-splashes";
import { PostProcessing } from "../../../vfx/PostProcessing";
import { QUANTIZATION_GRID } from "../../constants";
import { Domain, Material, Skybox, Terrain } from "../../components";
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
    <Terrain seed="123" />
    <Material riverTexture="potato_sack.jpg" />
    <Skybox topColor="#4a90d9" horizonColor="#87ceeb" bottomColor="#666666" />

    <DayNightLights />
    <DayNightCycle />
    <PostProcessing quantization={QUANTIZATION_GRID} />
    <FastTravel />
    {/* The spray of every river fall, wherever a river crosses: rivers belong to no biome. */}
    <RiverSplashes />

    <CityRegion />
    <DesertRegion />
    <SnowRegion />
    <OceanRegion />
  </Domain>
);
