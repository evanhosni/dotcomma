import * as THREE from "three";
import type { ProceduralClip, ProceduralLayer, ProceduralPose } from "../../../animation/types";

// The beeble's procedural animations (src/animation/README.md).
//
// The "ascend" clip: a sphere morph. Geometry is SHARED with the source GLTF and the
// clone is POOLED, so each mesh morphs a private clone and dispose() must
// restore the original — otherwise the next beeble reusing the clone
// inherited a sphere-morphed body, and the buffers leaked.

/** modelClonePool's MergedSkinnedPart, restated: this file is in the SERVER's type graph (the beeble
 *  spec imports it) and the pool is not Three-free. */
interface MergedSkinnedPart {
  start: number;
  count: number;
  center: [number, number, number];
  radius: number;
}

interface MorphTarget {
  posAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  original: Float32Array;
  sphere: Float32Array;
}

const INFLATE_SECONDS = 2;
const MAX_SCALE_UP = 0.5;

const beginInflate = (group: THREE.Object3D): ProceduralPose => {
  const swapped: { node: THREE.Mesh; original: THREE.BufferGeometry; cloned: THREE.BufferGeometry }[] = [];
  const targets: MorphTarget[] = [];

  group.traverse((node: any) => {
    if (!node.isMesh || !node.geometry) return;
    const originalGeometry = node.geometry as THREE.BufferGeometry;
    const cloned = originalGeometry.clone();
    node.geometry = cloned;
    swapped.push({ node, original: originalGeometry, cloned });

    const posAttr = cloned.getAttribute("position");
    if (!posAttr) return;
    const original = new Float32Array(posAttr.array.length);
    original.set(posAttr.array as Float32Array);

    const sphere = new Float32Array(original.length);
    const toSphere = (start: number, count: number, cx: number, cy: number, cz: number, radius: number) => {
      for (let i = start * 3; i < (start + count) * 3; i += 3) {
        const dx = original[i] - cx;
        const dy = original[i + 1] - cy;
        const dz = original[i + 2] - cz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
        sphere[i] = cx + (dx / dist) * radius;
        sphere[i + 1] = cy + (dy / dist) * radius;
        sphere[i + 2] = cz + (dz / dist) * radius;
      }
    };
    // A merged mesh (modelClonePool) inflates each source mesh's range onto that mesh's own sphere.
    const parts = originalGeometry.userData.mergedSkinnedParts as MergedSkinnedPart[] | undefined;
    if (parts) {
      for (const p of parts) toSphere(p.start, p.count, p.center[0], p.center[1], p.center[2], p.radius);
    } else {
      cloned.computeBoundingSphere();
      const { center, radius } = cloned.boundingSphere!;
      toSphere(0, original.length / 3, center.x, center.y, center.z, radius);
    }
    targets.push({ posAttr, original, sphere });
  });

  return {
    pose(time, weight) {
      const t = Math.min(Math.max(time / INFLATE_SECONDS, 0), 1) * weight;
      for (const m of targets) {
        const arr = m.posAttr.array as Float32Array;
        for (let i = 0; i < arr.length; i++) arr[i] = m.original[i] + (m.sphere[i] - m.original[i]) * t;
        m.posAttr.needsUpdate = true;
      }
      const s = 1 + t * MAX_SCALE_UP;
      group.scale.set(s, s, s);
    },
    dispose() {
      for (const s of swapped) {
        s.node.geometry = s.original;
        s.cloned.dispose();
      }
      targets.length = 0;
      group.scale.set(1, 1, 1);
    },
  };
};

export const ASCEND_CLIP: ProceduralClip = { name: "ascend", duration: INFLATE_SECONDS, create: beginInflate };

/** The head bone's yaw relative to the body and its pitch (radians, + = up), set by the behavior. */
export const HEAD_YAW_INPUT = "headYaw";
export const HEAD_PITCH_INPUT = "headPitch";
/** Farthest the head tilts up or down. */
export const MAX_HEAD_PITCH = (60 * Math.PI) / 180;
/** Height of the beeble's eyes above its feet (beeble.glb's eye meshes span y 1.77–1.87 at scale 1): where
 *  its head aims FROM. What it aims AT on a player is the player's eyes, its camera (player/spec.ts). */
export const BEEBLE_EYE_HEIGHT = 1.82;

/** The head's look, set in the BODY's frame: yaw about its up, then pitch about the turned head's right, both
 *  from the head's bind pose (beeble.glb's face looks level along the body's forward there). The clip's
 *  head is replaced and whatever it did to the bones above the head (a spine leaning into the walk or the
 *  idle) is undone, so pitch 0 is level whatever plays: posed in the parent's frame, the head took the
 *  spine's lean and looked down. An input left undefined is 0 while the other is set; both undefined keep
 *  the clip's head. Three objects are made in create (client-only): the server's three is a stub. */
export const HEAD_TURN_LAYER: ProceduralLayer = {
  name: "head-turn",
  create: (root) => {
    let head: THREE.Object3D | undefined;
    root.traverse((node: any) => {
      if (node.isBone && node.name === "head") head = node;
    });
    const rest = head?.quaternion.clone();
    const bind = new THREE.Quaternion();
    root.traverse((node: any) => {
      const i = node.isSkinnedMesh ? (node.skeleton.bones as THREE.Object3D[]).indexOf(head!) : -1;
      if (i < 0) return;
      new THREE.Matrix4()
        .copy(node.skeleton.boneInverses[i])
        .invert()
        .decompose(new THREE.Vector3(), bind, new THREE.Vector3());
    });
    const look = new THREE.Euler(0, 0, 0, "YXZ");
    const target = new THREE.Quaternion();
    const above = new THREE.Quaternion();
    return {
      pose(inputs, weight) {
        const yaw = inputs[HEAD_YAW_INPUT];
        const pitch = inputs[HEAD_PITCH_INPUT];
        if (!head || (yaw === undefined && pitch === undefined)) return;
        // The head's parent chain up to the model root, as the clip posed it this frame.
        above.identity();
        for (let node = head.parent; node && node !== root; node = node.parent) above.premultiply(node.quaternion);
        // + about the body's right tilts its forward (+z) down: up is −pitch.
        target.setFromEuler(look.set(-(pitch ?? 0), yaw ?? 0, 0)).multiply(bind);
        target.premultiply(above.invert());
        if (weight >= 1) head.quaternion.copy(target);
        else head.quaternion.slerpQuaternions(rest!, target, weight);
      },
      dispose() {
        if (head && rest) head.quaternion.copy(rest);
      },
    };
  },
};
