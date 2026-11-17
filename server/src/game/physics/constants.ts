import { CHUNK_SIZE, LOD1_SEGMENTS } from "../../../../src/world/terrain/lod/constants";
import type { DomainId } from "../../../../src/net/protocol/types";

export const TERRAIN_CHUNK_SIZE = CHUNK_SIZE;
export const TERRAIN_SEGMENTS = LOD1_SEGMENTS;
/** Vertices per side; a row is the unit of work for budgeted incremental chunk builds. */
export const TERRAIN_ROWS = TERRAIN_SEGMENTS + 1;
/** 4.375u: what the heightfield resolves. */
export const TERRAIN_VERTEX_SPACING = TERRAIN_CHUNK_SIZE / TERRAIN_SEGMENTS;

export const PHYSICS_DOMAIN: DomainId = "overworld";
export const DEFAULT_WORK_BUDGET_MS = 8;
