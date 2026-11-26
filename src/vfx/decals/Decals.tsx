import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { instancedTemplate, warmPrograms } from "../../utils/render";
import { DecalLayer } from "./DecalLayer";
import { DECAL_KINDS } from "./enums";
import { takeDecalStamps } from ".";
import { decalMaterial, decalTime } from "./material";
import { DECAL_LOOKS } from "./registry";
import type { DecalKind } from "./types";

/**
 * THE decals (stampDecal, index.ts): marks lying on the world's surfaces, a layer per kind (DecalLayer.ts):
 * the blood that lands, the bullet holes where a shot stopped. Mounted once with the canvas.
 */
export const Decals = () => {
  const scene = useThree((s) => s.scene);
  const materials = useMemo(() => Object.fromEntries(DECAL_KINDS.map((kind) => [kind, decalMaterial(DECAL_LOOKS[kind])])) as Record<DecalKind, ReturnType<typeof decalMaterial>>, []);
  const layers = useMemo(
    () => Object.fromEntries(DECAL_KINDS.map((kind) => [kind, new DecalLayer(scene, materials[kind], DECAL_LOOKS[kind])])) as Record<DecalKind, DecalLayer>,
    [scene, materials],
  );

  useEffect(() => {
    const cancelWarm = warmPrograms(scene, DECAL_KINDS.map((kind) => instancedTemplate(materials[kind])));
    return () => {
      cancelWarm();
      for (const kind of DECAL_KINDS) {
        layers[kind].dispose();
        materials[kind].dispose();
      }
    };
  }, [scene, layers, materials]);

  useFrame((state) => {
    const now = (decalTime.value = state.clock.elapsedTime);
    for (const stamp of takeDecalStamps()) layers[stamp.kind].add(stamp, now);
    for (const kind of DECAL_KINDS) layers[kind].update(now);
  });

  return null;
};
