import React from "react";
import { PostProcessing } from "../../../vfx/PostProcessing";
import { Domain, Material, Skybox, Terrain } from "../../components";
import { DayNightCycle } from "../../sky/DayNightCycle";
import { GLITCH_CITY_SEED } from "./config";
import { CityRegion, DesertRegion } from "./regions";

/**
 * glitch-city — the main game domain (route: /glitch-city).
 *
 * Everything is declared as components: <Domain> hosts the global rulesets
 * (terrain rules, materials, skybox, post-processing) and mounts the global
 * systems (terrain chunk system, spawn system, skybox system); each <Region>
 * child declares its biomes; each biome declares its terrain, material,
 * actors, dressing, foliage, and always-mounted visuals.
 *
 * To add a region: create it under this domain's regions/ folder and mount
 * it here (JSX order = voronoi order) — and list it in config.ts, the shared
 * description the SERVER runs on (the commit warns in dev when they differ).
 */
export const GlitchCityDomain = React.memo(() => (
  <Domain>
    {/* Global terrain rules — omitted props use DEFAULT_TERRAIN_PARAMS. The
        seed (and everything else the server needs) is mirrored by config.ts,
        the shared Three-free description the server simulates on. */}
    <Terrain seed={GLITCH_CITY_SEED} />
    {/* Texture blended between regions (rivers) */}
    <Material riverTexture="blue_mud.jpg" />
    {/* Default DAY sky — regions/biomes can mount their own <Skybox> to
        override; the day/night cycle blends whatever sky is active toward the
        night palette. */}
    <Skybox topColor="#4a90d9" horizonColor="#87ceeb" bottomColor="#666666" />
    {/* Jittery low-poly sun/moon + stars; follows the player so the sky never
        leaves render distance */}
    <DayNightCycle />
    {/* PostProcessing also takes fpsCap={n} (currently unset): it caps only
        the PRESENTED frame — the rAF loop (physics, AI, spawning, all
        dt-based) keeps running at display rate. A steady capped 60 with
        headroom reads smoother than a fluctuating 100. */}
    {/* curvature = the illusory planet radius: past curvatureStart units
        everything sinks by (d - start)² / (2 × radius), so the world falls
        away behind a curved horizon (vfx/curvature.ts). Visual only —
        the player still walks a flat plane. */}
    <PostProcessing quantization={0.025} />

    <CityRegion />
    <DesertRegion />
  </Domain>
));
