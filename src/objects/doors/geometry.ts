import * as THREE from "three";
import { bakeVertexColor, mergeOrThrow } from "../../utils/render/geometry";
import type { DoorHandle, DoorLeafBox, DoorFit } from "./types";
import { LEAF_OVERLAP_WIDTH, LEAF_CLEARANCE, LEAF_OVERLAP_HEIGHT, LEAF_LIFT, LEAF_THICKNESS, HANDLE_INSET, HANDLE_HEIGHT_SHARE, SPINDLE_RADIUS, HANDLE_STANDOFF, LEVER_SIZE, LEVER_SETBACK, KNOB_RADIUS } from "./constants";

/** A leaf for an opening `width` × `height` in `color`, with its handle on both faces: vertex-colored,
 *  uv dropped, origin at the hinge edge. Returns the leaf's box too, for far stand-ins. */
export const makeDoorGeometry = (width: number, height: number, color: number, handle: DoorHandle, fit: DoorFit = "overlap"): { geometry: THREE.BufferGeometry; leaf: DoorLeafBox } => {
  const leafW = fit === "overlap" ? width + LEAF_OVERLAP_WIDTH : width - 2 * LEAF_CLEARANCE;
  const leafH = fit === "overlap" ? height + LEAF_OVERLAP_HEIGHT : height - LEAF_CLEARANCE - LEAF_LIFT;
  // The mesh is mounted at height / 2: the overlap leaf is centred LEAF_LIFT above that; the inside leaf
  // is centred so it spans LEAF_LIFT over the floor to LEAF_CLEARANCE under the lintel.
  const leaf: DoorLeafBox = { center: [fit === "overlap" ? leafW / 2 - LEAF_OVERLAP_WIDTH / 2 : leafW / 2 + LEAF_CLEARANCE, fit === "overlap" ? LEAF_LIFT : (LEAF_LIFT - LEAF_CLEARANCE) / 2, 0], size: [leafW, leafH, LEAF_THICKNESS], color };
  const x = leaf.center[0] + leaf.size[0] / 2 - HANDLE_INSET;
  const y = -height / 2 + height * HANDLE_HEIGHT_SHARE;
  const face = leaf.size[2] / 2;
  const parts: THREE.BufferGeometry[] = [
    bakeVertexColor(new THREE.BoxGeometry(...leaf.size).translate(...leaf.center).toNonIndexed(), color),
    bakeVertexColor(new THREE.CylinderGeometry(SPINDLE_RADIUS, SPINDLE_RADIUS, leaf.size[2] + 2 * (HANDLE_STANDOFF + 0.02), 8).rotateX(Math.PI / 2).translate(x, y, 0).toNonIndexed(), handle.color),
  ];
  for (const side of [1, -1]) {
    const z = side * (face + HANDLE_STANDOFF);
    parts.push(
      bakeVertexColor(
        handle.lever ? new THREE.BoxGeometry(...LEVER_SIZE).translate(x - LEVER_SETBACK, y, z).toNonIndexed() : new THREE.SphereGeometry(KNOB_RADIUS, 10, 8).translate(x, y, z).toNonIndexed(),
        handle.color,
      ),
    );
  }
  const geometry = mergeOrThrow(parts, "door leaf");
  geometry.deleteAttribute("uv");
  return { geometry, leaf };
};
