import { caveBiomeIds, sewerBiomeIds } from "../../../../src/utils/workers/biomeFlags";
import { buildUndergroundChunk } from "../../../../src/utils/workers/underground/chunkMesh";
import type { TunnelSpaceChunk } from "../../../../src/utils/workers/underground/tunnelSpace";
import type { UndergroundChunk } from "../../../../src/utils/workers/underground/types";
import { dressingChunkBounds } from "./obstaclePoints.js";

/**
 * The tunnels an NPC moves through: per dressing chunk, every tunnel style under every biome that holds
 * one, built by the client's own chunk builder (utils/workers/underground/chunkMesh.ts) and kept as what
 * a body needs — the probe's pieces and entrances, the liquid, and the colliders (the brick columns plus
 * the ladders and closed doors: colliderBodies.ts). Rapier-free: the generation worker runs it.
 */

export type TunnelPart = TunnelSpaceChunk & Pick<UndergroundChunk, "colliders" | "entrances" | "doors">;

export const sampleTunnelChunk = (gx: number, gz: number): TunnelPart[] => {
  const bounds = dressingChunkBounds(gx, gz);
  const out: TunnelPart[] = [];
  const add = (chunk: UndergroundChunk | null): void => {
    if (!chunk) return;
    const { style, centerX, centerZ, pieces, systemEntrances, liquid, colliders, entrances, doors } = chunk;
    out.push({ style, centerX, centerZ, pieces, systemEntrances, liquid, colliders, entrances, doors });
  };
  for (const id of sewerBiomeIds()) add(buildUndergroundChunk(bounds, "sewer", id));
  for (const id of caveBiomeIds()) add(buildUndergroundChunk(bounds, "cave", id));
  return out;
};
