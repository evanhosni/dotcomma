import { dropOldestHalf } from "../cellCache";
import { FIELD_REACH, SEWER_LIQUID_VISCOSITY } from "./constants";
import { liquidLevelOf } from "./sewerMesh";
import { compileField, inFrontOfMouthOpening, insideMouthCut, mouthFootprintBounds, probeRockAlongY, rockEscapeAt, surfaceAboveAt, type FieldFn, type RockEscape } from "./tunnelField";
import type { ShaftPiece, TunnelEntrance, TunnelPiece, UndergroundChunk } from "./types";

/**
 * THE TUNNELS AS A BODY SEES THEM: the air of a set of loaded tunnel chunks, merged (a piece two chunks
 * list counts once), with a compiled probe field per cell, and the questions a capsule's step asks —
 * is this point in the air, where is the floor, where is the way out of rock, which manhole's column
 * holds it, what liquid. Three-free: the client registry owns one (the player), the server's physics
 * world another (its NPCs), so both move by the same answers (physics/tunnelRules.ts).
 */

/** What a body's step needs of a chunk (the client has the whole UndergroundChunk; the server keeps this). */
export type TunnelSpaceChunk = Pick<UndergroundChunk, "style" | "centerX" | "centerZ" | "pieces" | "systemEntrances" | "liquid">;

export type LiquidLook = "water" | "sewage";

export interface UndergroundProbe {
  /** False while no tunnel chunk is loaded at all: the field is not known (a body keeps its last state). */
  known: boolean;
  /** The field at the point: negative in the air. */
  field: number;
  /** The first rock below the point; NaN out of the air. */
  floorY: number;
  /** The liquid level whose swimming range holds the point; NaN when none. */
  liquidY: number;
  /** That liquid's viscosity relative to water: a spring cave's water is water, the sewers' liquid is thick. */
  liquidViscosity: number;
  /** What the liquid looks like from under it. */
  liquidLook: LiquidLook;
}

/** The probe index's cell size. */
const CELL = 32;
/** Compiled fields kept per cell before the oldest half goes. */
const FIELDS_MAX = 1024;
/** The liquid's swimming range: this far over its surface. */
const SWIM_ABOVE_SURFACE = 3;
/** The floor probe: steps down from the probe point to the first rock, then bisects. */
const FLOOR_STEP = 0.5;
const FLOOR_REACH = 30;
/** A manhole's column holds a point from this far under its box floor to this far over the street. */
const COLUMN_BELOW_FLOOR = 0.5;
const COLUMN_ABOVE_STREET = 1;

const pieceKey = (p: TunnelPiece): string => {
  switch (p.kind) {
    case "tube":
      return `t|${p.ax},${p.ay},${p.az}|${p.bx},${p.by},${p.bz}`;
    case "mouth":
      return `m|${p.id}`;
    case "room":
      return `r|${p.ax},${p.az}|${p.bx},${p.bz}`;
    case "cone":
      return `c|${p.x},${p.y},${p.z}`;
    case "box":
      return `b|${p.cx},${p.cz},${p.floor},${p.halfX}`;
    case "pipe":
      return `p|${p.ax},${p.az}|${p.bx},${p.bz}`;
    case "shaft":
      return `s|${p.id}`;
  }
};

const cellKeyOf = (x: number, z: number): number => Math.floor(x / CELL) * 0x100000 + Math.floor(z / CELL);

export class TunnelSpace {
  private readonly chunks = new Set<TunnelSpaceChunk>();
  private piecesList: TunnelPiece[] = [];
  private shaftList: ShaftPiece[] = [];
  private entranceMap = new Map<string, TunnelEntrance>();
  private cellPieces = new Map<number, TunnelPiece[]>();
  private cellFields = new Map<number, FieldFn>();
  private readonly probeResult: UndergroundProbe = { known: false, field: FIELD_REACH, floorY: NaN, liquidY: NaN, liquidViscosity: 1, liquidLook: "water" };
  /** The style of the chunk the last liquid level came from. */
  private liquidStyle: TunnelSpaceChunk["style"] = "sewer";
  private readonly shaftOpen = (s: ShaftPiece): boolean => this.isOpen(s.id);

  /** `isOpen`: a manhole's (and a door's) open state, by id. */
  constructor(private readonly isOpen: (id: string) => boolean) {}

  get size(): number {
    return this.chunks.size;
  }
  get pieces(): readonly TunnelPiece[] {
    return this.piecesList;
  }
  get shafts(): readonly ShaftPiece[] {
    return this.shaftList;
  }
  /** Every entrance of the loaded chunks' systems, by id. */
  get entrances(): ReadonlyMap<string, TunnelEntrance> {
    return this.entranceMap;
  }

  add(chunk: TunnelSpaceChunk): void {
    this.chunks.add(chunk);
    this.rebuild();
  }

  remove(chunk: TunnelSpaceChunk): boolean {
    if (!this.chunks.delete(chunk)) return false;
    this.rebuild();
    return true;
  }

  /** A toggle changes a manhole's shaft top: the compiled fields are stale. */
  invalidateFields(): void {
    this.cellFields = new Map();
  }

  private rebuild(): void {
    const byKey = new Map<string, TunnelPiece>();
    const entrances = new Map<string, TunnelEntrance>();
    for (const c of this.chunks) {
      for (const p of c.pieces) if (!byKey.has(pieceKey(p))) byKey.set(pieceKey(p), p);
      for (const e of c.systemEntrances) entrances.set(e.id, e);
    }
    this.piecesList = Array.from(byKey.values());
    this.shaftList = this.piecesList.filter((p): p is ShaftPiece => p.kind === "shaft");
    this.entranceMap = entrances;
    this.cellPieces = new Map();
    this.cellFields = new Map();
  }

  /** The compiled probe field of the cell holding (x, z): the pieces in reach, without the formations. */
  private fieldAt(x: number, z: number): FieldFn {
    const key = cellKeyOf(x, z);
    let f = this.cellFields.get(key);
    if (f) return f;
    let list = this.cellPieces.get(key);
    if (!list) {
      const minX = Math.floor(x / CELL) * CELL;
      const minZ = Math.floor(z / CELL) * CELL;
      list = this.piecesList.filter(
        (p) => p.kind !== "cone" && p.bounds.minX - FIELD_REACH <= minX + CELL && p.bounds.maxX + FIELD_REACH >= minX && p.bounds.minZ - FIELD_REACH <= minZ + CELL && p.bounds.maxZ + FIELD_REACH >= minZ,
      );
      this.cellPieces.set(key, list);
    }
    if (this.cellFields.size >= FIELDS_MAX) dropOldestHalf(this.cellFields);
    f = compileField(list, { shaftOpen: this.shaftOpen, withCones: false });
    this.cellFields.set(key, f);
    return f;
  }

  /** The liquid level at (x, z) from the loaded chunks' liquid triangles; NaN when none. */
  liquidLevelAt(x: number, z: number): number {
    for (const c of this.chunks) {
      if (!c.liquid) continue;
      const level = liquidLevelOf(c.liquid, x - c.centerX, z - c.centerZ);
      if (!Number.isNaN(level)) {
        this.liquidStyle = c.style;
        return level;
      }
    }
    return NaN;
  }

  /** The field, the floor and the liquid at a point. The result object is SHARED: read it before the next call. */
  probe(x: number, y: number, z: number): UndergroundProbe {
    const probe = this.probeResult;
    const field = this.chunks.size === 0 ? FIELD_REACH : this.fieldAt(x, z)(x, y, z);
    probe.known = this.chunks.size > 0;
    probe.field = field;
    probe.floorY = NaN;
    probe.liquidY = NaN;
    if (field < 0) {
      probe.floorY = probeRockAlongY(this.fieldAt(x, z), x, y, z, -1, FLOOR_STEP, FLOOR_REACH);
      const level = this.liquidLevelAt(x, z);
      // The point's liquid: its surface stands over the floor under the point (a walkway stands over the
      // channel's surface; a room's pool floor lies 5u under it) and the point is not far above it.
      if (!Number.isNaN(level) && level > probe.floorY && y <= level + SWIM_ABOVE_SURFACE) {
        probe.liquidY = level;
        probe.liquidViscosity = this.liquidStyle === "sewer" ? SEWER_LIQUID_VISCOSITY : 1;
        probe.liquidLook = this.liquidStyle === "sewer" ? "sewage" : "water";
      }
    }
    return probe;
  }

  /** Where a point standing in rock gets out, with `clearance` of air to spare (tunnelField.ts rockEscapeAt);
   *  null when it is not in rock, or no way out is found. */
  escapeFromRockAt(x: number, y: number, z: number, clearance: number): RockEscape | null {
    return this.chunks.size === 0 ? null : rockEscapeAt(this.fieldAt(x, z), x, y, z, clearance);
  }

  /** Whether a point stands in front of a loaded mouth's opening (tunnelField.ts inFrontOfMouthOpening): the
   *  field reads rock there, but it is open air. */
  inFrontOfOpeningAt(x: number, y: number, z: number): boolean {
    for (const p of this.piecesList) {
      if (p.kind !== "mouth") continue;
      const b = p.bounds;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (inFrontOfMouthOpening(p, x, y, z)) return true;
    }
    return false;
  }

  /** Whether a point is in a loaded mouth's terrain cut (tunnelField.ts insideMouthCut): there the entrance
   *  patch is the ground, and the terrain's heightfield, which draws nothing there, is not. */
  inMouthCutAt(x: number, y: number, z: number): boolean {
    for (const p of this.piecesList) {
      if (p.kind !== "mouth") continue;
      const b = mouthFootprintBounds(p);
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (insideMouthCut(p, x, y, z)) return true;
    }
    return false;
  }

  /** The SURFACE of the air over a point that stands in rock, within `reach` up (0.25u steps, bisected
   *  to the rock's edge): the floor a body sank through, from the field the walls were meshed from.
   *  NaN when none (deep rock). */
  airAboveAt(x: number, y: number, z: number, reach: number): number {
    return this.chunks.size === 0 ? NaN : surfaceAboveAt(this.fieldAt(x, z), x, y, z, 0.25, reach);
  }

  /** The manhole whose shaft column holds (x, feet, z), with its open state; null when none. */
  manholeColumnAt(x: number, z: number, feet: number): { entrance: TunnelEntrance; open: boolean } | null {
    for (const e of this.entranceMap.values()) {
      if (e.kind !== "manhole" || !e.manhole) continue;
      const dx = x - e.x;
      const dz = z - e.z;
      if (dx * dx + dz * dz > e.radius * e.radius) continue;
      if (feet < e.manhole.floorY - COLUMN_BELOW_FLOOR || feet > e.manhole.streetY + COLUMN_ABOVE_STREET) continue;
      return { entrance: e, open: this.isOpen(e.id) };
    }
    return null;
  }
}
