import * as THREE from "three";
import type { Cut } from "../../../net/protocol/types";
import { seededStream } from "../../../utils/math";
import { GIB_PLANES, GIB_SPREAD } from "./constants";

/** A cut's identity: two lists of cuts are the same body when their keys match in order. */
export const cutKey = (cut: Cut): string => cut.p.map((p) => `${p.b}:${p.nx.toFixed(5)},${p.ny.toFixed(5)},${p.nz.toFixed(5)},${p.d.toFixed(5)}`).join("|");

/** A blast's burst of the body whose bind-space bounds are `bounds`: GIB_PLANES planes through it, each
 *  cutting every bone, turned and placed by `seed` (the body's id), so every client bursts it alike. */
export const gibCutsOf = (seed: string, bounds: THREE.Box3): Cut[] => {
  const random = seededStream(`gib:${seed}`);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const cuts: Cut[] = [];
  for (let i = 0; i < GIB_PLANES; i++) {
    const z = random.between(-1, 1);
    const turn = random.between(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    const n = new THREE.Vector3(r * Math.cos(turn), z, r * Math.sin(turn));
    const at = new THREE.Vector3(
      center.x + random.between(-0.5, 0.5) * size.x * GIB_SPREAD,
      center.y + random.between(-0.5, 0.5) * size.y * GIB_SPREAD,
      center.z + random.between(-0.5, 0.5) * size.z * GIB_SPREAD,
    );
    cuts.push({ p: [{ b: "*", nx: n.x, ny: n.y, nz: n.z, d: n.dot(at) }] });
  }
  return cuts;
};
