import { useGLTF } from "@react-three/drei/core/useGLTF";
import { useRapier } from "@react-three/rapier";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { BEEBLE_SPEC } from "../../objects/actors/beeble/spec";
import { acquireModelClone, markPoseChanged, reclaimModelClone, releaseModelClone } from "../../objects/actors/model/store";
import { Ragdoll } from "../../objects/actors/ragdoll/Ragdoll";
import { skeletonLayoutOf } from "../../objects/actors/ragdoll/utils";
import { collectSkinnedMeshes } from "../../objects/actors/model/geometry";
import { KILL_CARRY, KILL_PUSH, MAX_WOUNDS } from "../../objects/actors/wounds/constants";
import type { Cut, Wound } from "../../net/protocol/types";
import { GIB_SPEED, GIB_SPIN } from "../../objects/actors/slices/constants";
import { registerCorpse } from "./registry";
import type { CorpseOrder, CorpseStep } from "./types";

// A per-module path: drei 9.87's index re-exports SpotLight, which imports LinearEncoding (removed in three r162).

const MODEL = BEEBLE_SPEC.model!;

/** Copies `from`'s bones' local pose onto `to`'s, by name (two clones of one model). */
const copyPose = (from: THREE.Object3D, to: THREE.Object3D): void => {
  const bones = new Map<string, THREE.Object3D>();
  from.traverse((node) => {
    if ((node as THREE.Bone).isBone) bones.set(node.name, node);
  });
  to.traverse((node) => {
    const source = (node as THREE.Bone).isBone ? bones.get(node.name) : undefined;
    if (!source) return;
    node.position.copy(source.position);
    node.quaternion.copy(source.quaternion);
  });
};

/**
 * One dead player's beeble: a fresh clone in the pose its body died in, where it stood, bearing its wounds,
 * going limp at once (the actors' Ragdoll, thrown along the killing shot) and lying there, still taking
 * holes and shoves (registry.ts: every client's shots at it, by its id). Its frame is the Corpses' one loop.
 */
export const Corpse = ({ order, steps }: { order: CorpseOrder; steps: Set<CorpseStep> }) => {
  const gltf = useGLTF(MODEL, false);
  const [clone] = useState(() => acquireModelClone(MODEL, gltf, BEEBLE_SPEC.quantization));
  const { world, rapier } = useRapier();
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const group = groupRef.current;
    const stand = order.from.parent;
    const layout = skeletonLayoutOf(clone.scene);
    if (!group || !stand || !layout) return;
    reclaimModelClone(clone);
    group.position.copy(stand.position);
    group.rotation.copy(stand.rotation);
    copyPose(order.from, clone.scene);
    let wounds: readonly Wound[] = order.wounds;
    clone.wounds.set(wounds);
    group.visible = true;
    group.updateWorldMatrix(true, true);
    markPoseChanged(clone);
    const ragdoll = new Ragdoll(world, rapier, clone.scene, layout);
    const [dx, dy, dz] = order.dir;
    ragdoll.start({ bone: order.wounds[order.wounds.length - 1]?.entry.b[0] ?? "", x: dx * KILL_PUSH, y: dy * KILL_PUSH, z: dz * KILL_PUSH, carry: KILL_CARRY }, null);
    let cuts: Cut[] = order.cuts;
    let gib = order.gib ?? null;
    let exploded = false;
    /** Its cuts and burst (slices/): the killing blow's, then every later strike's. */
    const slice = (): void => {
      if (!clone.slices.set(cuts, gib ? order.id : null, true)) return;
      ragdoll.rebuild();
      if (!gib || exploded) return;
      exploded = true;
      ragdoll.explode(new THREE.Vector3(gib[0], gib[1], gib[2]), GIB_SPEED, GIB_SPIN);
    };
    slice();
    const meshes: THREE.SkinnedMesh[] = [];
    collectSkinnedMeshes(clone.scene as THREE.Group, meshes);
    const unregister = registerCorpse({
      id: order.id,
      meshes,
      center: (out) => ragdoll.center(out) ?? out.copy(group.position),
      wound: (more) => {
        wounds = [...wounds, ...more].slice(-MAX_WOUNDS);
        clone.wounds.set(wounds);
      },
      push: (impulse) => ragdoll.push(impulse),
      strike: (blow) => {
        if (blow.cuts) cuts = [...cuts, ...blow.cuts];
        if (blow.gib) gib ??= blow.gib;
        slice();
      },
    });
    const step: CorpseStep = () => {
      ragdoll.step();
      markPoseChanged(clone);
    };
    steps.add(step);
    return () => {
      unregister();
      steps.delete(step);
      // Before the ragdoll lets go: it restores the standing pose onto bones the slices put back.
      clone.slices.dispose();
      ragdoll.dispose();
      markPoseChanged(clone);
      releaseModelClone(clone);
    };
  }, [clone, order, steps, world, rapier]);

  return (
    <group ref={groupRef} visible={false}>
      <primitive object={clone.scene} scale={BEEBLE_SPEC.scale ?? [1, 1, 1]} />
    </group>
  );
};
