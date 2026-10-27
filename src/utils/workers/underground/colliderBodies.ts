import { type DressingColliderBody, yawFromDir } from "../../../objects/dressing/types";
import type { UndergroundChunk } from "./types";

/** The rungs' collider slab: its face this far from the shaft's center on the exit side. */
export const LADDER_FACE = 0.98;
const LADDER_SLAB_WIDTH = 0.8;
const LADDER_SLAB_DEPTH = 0.2;
const DOOR_SLAB_THICKNESS = 0.15;

/** A tunnel chunk's collider bodies: the brick columns, a slab per ladder, a slab per CLOSED door — the
 *  client's (objects/dressing/underground) and the server's (its NPCs) from one function. Three-free.
 *  Every key names the chunk: a triangle's column is by its centroid, and a patch triangle just past the
 *  chunk's edge puts a column centred in the NEIGHBOUR's ground — the neighbour's own column there has
 *  the same x, z, and keyed by position alone the client built one of the two (Evan's fall through a
 *  cave floor at (4854.5, -3358.5): the 1954-triangle floor column lost to a 45-triangle sliver). */
export const tunnelColliderBodies = (chunk: Pick<UndergroundChunk, "centerX" | "centerZ" | "colliders" | "entrances" | "doors">, isOpen: (id: string) => boolean): DressingColliderBody[] => {
  const bodies: DressingColliderBody[] = [];
  const chunkKey = `${chunk.centerX},${chunk.centerZ}`;
  for (const c of chunk.colliders) bodies.push({ key: `${chunkKey}|column|${c.x},${c.z}`, x: c.x, y: 0, z: c.z, yaw: 0, parts: [], mesh: { vertices: c.vertices, indices: c.indices } });
  for (const e of chunk.entrances) {
    const info = e.kind === "manhole" ? e.manhole : undefined;
    if (!info) continue;
    bodies.push({
      key: `${chunkKey}|ladder|${e.id}`,
      x: e.x + info.faceX * LADDER_FACE,
      y: (info.floorY + info.streetY) / 2,
      z: e.z + info.faceZ * LADDER_FACE,
      yaw: yawFromDir(info.faceX, info.faceZ),
      parts: [{ w: LADDER_SLAB_DEPTH, h: info.streetY - info.floorY, d: LADDER_SLAB_WIDTH, x: LADDER_SLAB_DEPTH / 2, y: 0 }],
    });
  }
  for (const d of chunk.doors) {
    if (isOpen(d.id)) continue;
    bodies.push({ key: `${chunkKey}|door|${d.id}`, x: d.x, y: d.y + d.height / 2, z: d.z, yaw: d.yaw, parts: [{ w: d.width, h: d.height, d: DOOR_SLAB_THICKNESS, x: 0, y: 0 }] });
  }
  return bodies;
};
