import { BRICK } from "../constants";
import type { ColumnCollider } from "../types";
import type { Vertex } from "./types";

interface Column {
  key: number;
  x: number;
  z: number;
  vertices: number[];
  indices: number[];
}

/** The chunk's drawn mesh and its colliders, assembled from finished triangles. `colored`: the sewers
 *  carry vertex colors; the cave rock's color is the material's formula (no buffer). */
export class ChunkAssembly {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly daylight: number[] = [];
  readonly indices: number[] = [];
  readonly columns = new Map<number, Column>();

  constructor(
    readonly centerX: number,
    readonly centerZ: number,
    readonly minX: number,
    readonly minZ: number,
    readonly colored: boolean,
  ) {}

  /** Adds a drawn triangle of three fresh vertices (the sewers' clipped triangles); `solid` adds it to
   *  its column's collider too. */
  triangle(a: Vertex, b: Vertex, c: Vertex, solid = true): void {
    this.indices.push(this.vertex(a), this.vertex(b), this.vertex(c));
    if (solid) this.collide(a, b, c);
  }

  private vertex(v: Vertex): number {
    const index = this.positions.length / 3;
    this.positions.push(v.x - this.centerX, v.y, v.z - this.centerZ);
    this.normals.push(v.nx, v.ny, v.nz);
    if (this.colored) this.colors.push(v.r, v.g, v.b);
    this.daylight.push(v.light);
    return index;
  }

  /** The nets' vertex ids → this mesh's indices (−1: not written yet), and per column → its collider's. */
  private sharedIndex = new Int32Array(0);
  private readonly columnIndex = new Map<number, Map<number, number>>();

  private sharedVertex(vertices: readonly Vertex[], id: number): number {
    if (this.sharedIndex.length < vertices.length) {
      const grown = new Int32Array(vertices.length).fill(-1);
      grown.set(this.sharedIndex);
      this.sharedIndex = grown;
    }
    let index = this.sharedIndex[id];
    if (index < 0) this.sharedIndex[id] = index = this.vertex(vertices[id]);
    return index;
  }

  /** Adds a drawn triangle of SHARED vertices (ids into `vertices`, the surface nets' output): a vertex
   *  is written on its first use and indexed after. `solid` adds it to its column's collider too. */
  triangleShared(vertices: readonly Vertex[], ia: number, ib: number, ic: number, solid = true): void {
    this.indices.push(this.sharedVertex(vertices, ia), this.sharedVertex(vertices, ib), this.sharedVertex(vertices, ic));
    if (solid) this.collideShared(vertices, ia, ib, ic);
  }

  private columnVertex(col: Column, map: Map<number, number>, vertices: readonly Vertex[], id: number): number {
    let local = map.get(id);
    if (local === undefined) {
      local = col.vertices.length / 3;
      const v = vertices[id];
      col.vertices.push(v.x - col.x, v.y, v.z - col.z);
      map.set(id, local);
    }
    return local;
  }

  /** Adds a triangle of shared vertices to its column's collider only (the entrance patch's: the terrain's
   *  program draws it). */
  collideShared(vertices: readonly Vertex[], ia: number, ib: number, ic: number): void {
    const col = this.column(vertices[ia], vertices[ib], vertices[ic]);
    let map = this.columnIndex.get(col.key);
    if (!map) this.columnIndex.set(col.key, (map = new Map()));
    col.indices.push(this.columnVertex(col, map, vertices, ia), this.columnVertex(col, map, vertices, ib), this.columnVertex(col, map, vertices, ic));
  }

  private column(a: Vertex, b: Vertex, c: Vertex): Column {
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    const ix = Math.floor((cx - this.minX) / BRICK);
    const iz = Math.floor((cz - this.minZ) / BRICK);
    const key = ix * 64 + iz;
    let col = this.columns.get(key);
    if (!col) {
      col = { key, x: this.minX + (ix + 0.5) * BRICK, z: this.minZ + (iz + 0.5) * BRICK, vertices: [], indices: [] };
      this.columns.set(key, col);
    }
    return col;
  }

  collide(a: Vertex, b: Vertex, c: Vertex): void {
    const col = this.column(a, b, c);
    for (const v of [a, b, c]) {
      col.indices.push(col.vertices.length / 3);
      col.vertices.push(v.x - col.x, v.y, v.z - col.z);
    }
  }

  mesh() {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      daylight: new Float32Array(this.daylight),
      indices: new Uint32Array(this.indices),
    };
  }

  colliders(): ColumnCollider[] {
    return Array.from(this.columns.values(), (c) => ({ x: c.x, z: c.z, vertices: new Float32Array(c.vertices), indices: new Uint32Array(c.indices) }));
  }
}
