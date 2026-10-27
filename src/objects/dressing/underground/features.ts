import { CAVE_CHANCE, ROOM_TIP_CHANCE, ROOM_TRUNK_CHANCE, SEWER_CHANCE, SIDE_ROOM_CHANCE } from "../../../utils/workers/underground/constants";
import type { CaveParams, SewerParams } from "../../../utils/workers/types";
import { defineFeature, findFeature, type FeatureNode } from "../../../world/features";

/** The tunnels' FEATURE declarations (world/features.ts), for a biome spec's `features`. Three-free:
 *  the server reads them. <Biome> draws a mounted <Sewers> or <Caves> with Underground.tsx's views. */

export interface CavesProps {
  /** The chance a biome cell holds a system (default 0.6). */
  chance?: number;
  /** View only (default 1096: the LOD1 site ring + a chunk). */
  renderDistance?: number;
  /** View only (default 64). */
  colliderDistance?: number;
}

/** Caves under a biome's cells: their mouths open in its slopes (the terrain bulges them: mouthBulge.ts). */
export const Caves = defineFeature<CavesProps>("caves");

export interface CaveSideRoomProps {
  /** The chance of a room on the trunk, clear of the mouths (default 0.5). */
  trunkChance?: number;
  /** The chance of a room at each branch's tip (default 0.35). */
  tipChance?: number;
}

/** Rooms off a cave's passages; a <Spawn> inside stands one actor in each. */
export const CaveSideRoom = defineFeature<CaveSideRoomProps>("sideRooms", "caves");

/** The caves' generation params from a biome's feature tree (null: no <Caves>). */
export const caveParamsFrom = (tree: readonly FeatureNode[]): CaveParams | null => {
  const caves = findFeature(tree, "caves");
  if (!caves) return null;
  const rooms = findFeature(tree, "caves.sideRooms")?.params as CaveSideRoomProps | undefined;
  return {
    chance: (caves.params as CavesProps).chance ?? CAVE_CHANCE,
    sideRooms: rooms ? { trunkChance: rooms.trunkChance ?? ROOM_TRUNK_CHANCE, tipChance: rooms.tipChance ?? ROOM_TIP_CHANCE } : null,
  };
};

export interface SewersProps {
  /** The chance a biome cell holds a system (default 0.75). */
  chance?: number;
  /** View only (default 300). */
  renderDistance?: number;
  /** View only (default 64). */
  colliderDistance?: number;
}

/** Sewers under a road-bearing biome's streets. */
export const Sewers = defineFeature<SewersProps>("sewers");

export interface SewerSideRoomProps {
  /** The chance a junction gets a door into a side room (kept only where the room fits; default 0.45). */
  chance?: number;
}

/** Side rooms behind doors off the sewers' junctions; a <Spawn> inside stands one actor in each. */
export const SewerSideRoom = defineFeature<SewerSideRoomProps>("sideRooms", "sewers");

/** The sewers' generation params from a biome's feature tree (null: no <Sewers>). */
export const sewerParamsFrom = (tree: readonly FeatureNode[]): SewerParams | null => {
  const sewers = findFeature(tree, "sewers");
  if (!sewers) return null;
  const sideRooms = findFeature(tree, "sewers.sideRooms");
  return {
    chance: (sewers.params as SewersProps).chance ?? SEWER_CHANCE,
    sideRooms: sideRooms ? { chance: (sideRooms.params as SewerSideRoomProps).chance ?? SIDE_ROOM_CHANCE } : null,
  };
};
