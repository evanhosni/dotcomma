import React from "react";
import { CityRegion, DesertRegion } from "./regions";
import { DayNightCycle } from "../sky/DayNightCycle";
import { PostProcessing } from "../vfx/PostProcessing";
import { Material, Skybox, Terrain, World } from "./components";

/**
 * The game world — single source of truth for active content.
 *
 * Everything is declared as components: <World> hosts the global rulesets
 * (terrain rules, materials, skybox, post-processing) and mounts the global
 * systems (terrain chunk system, spawn system, skybox system); each <Region>
 * child declares its biomes; each biome declares its terrain, material,
 * spawnables, and always-mounted visuals.
 *
 * To add a region: create a component in src/regions/ and mount it here.
 */
export const GameWorld = React.memo(() => (
  <World>
    {/* Global terrain rules — omitted props use DEFAULT_WORLD_TERRAIN_PARAMS */}
    <Terrain seed="123" />
    {/* Texture blended between regions (rivers) */}
    <Material riverTexture="blue_mud.jpg" />
    {/* Default DAY sky — regions/biomes can mount their own <Skybox> to
        override; the day/night cycle blends whatever sky is active toward the
        night palette. */}
    <Skybox topColor="#4a90d9" horizonColor="#87ceeb" bottomColor="#666666" />
    {/* Jittery low-poly sun/moon + stars; follows the player so the sky never
        leaves render distance */}
    <DayNightCycle />
    <PostProcessing quantization={0.025} />

    <CityRegion />
    <DesertRegion />
  </World>
));
