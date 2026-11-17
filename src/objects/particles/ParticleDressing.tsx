import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildParticleChunk } from "./geometry";
import { ParticleWriter } from "./ParticleWriter";
import { createParticleMaterial, tickParticles } from "./material";
import { meshTemplate } from "../../utils/render";
import { selfPatchedMaterial, useChunkAssets, useWorldChunks } from "../dressing/hooks";
import { declare } from "../../world/content";
import type { ContentComponent } from "../../world/content/types";
import { featureMounts } from "../../generation/registry";
import { WATER_BODY_KINDS, waterBasePart } from "../../generation/water/params";
import { CHANNEL_BODY_KINDS } from "../../generation/water/channel/params";
import { WATER_ZONE_DEFAULTS, waterBodiesWith } from "../../generation/water/parts/params";
import { farthest } from "../dressing/utils";
import { enumerateDressing } from "../dressing/worker";
import type { DressingEnumeratorName, EnumeratorArgs } from "../dressing/types";
import type { ParticleDressingSpec, ParticleProps, KnobGroup } from "./types";

/** A particle feature as ONE declaration: mounting it is what makes it exist, and the single
 *  driver below draws every mount (chunks are world-space). */
export const createParticleDressing = <K extends DressingEnumeratorName, Knobs extends object>(
  spec: ParticleDressingSpec<K, Knobs>,
): ContentComponent<ParticleProps & Partial<Knobs>> => {
  type Mount = ParticleProps & Partial<Knobs>;
  const knobsOf = (props: Mount): Knobs => {
    const knobs = { ...spec.knobs };
    for (const key of Object.keys(spec.knobs) as (keyof Knobs)[]) if (props[key] !== undefined) knobs[key] = props[key] as Knobs[keyof Knobs];
    return knobs;
  };
  const onWater = spec.within === "waterBody" || spec.within === "channelBody";
  const defaultKnobs = JSON.stringify(spec.knobs);
  const argsOf = (g: KnobGroup<Knobs>): EnumeratorArgs<K> => {
    if (!onWater) return spec.emitters(g.knobs) as EnumeratorArgs<K>;
    const key = JSON.stringify(g.knobs);
    const seedTag = spec.seedTag === undefined ? {} : { seedTag: key === defaultKnobs ? spec.seedTag : `${spec.seedTag}|${key}` };
    return { ...spec.emitters(g.knobs), ...seedTag, bodies: g.bodies } as EnumeratorArgs<K>;
  };
  const Particles = () => {
    const base = spec.within === "water" ? waterBasePart<Mount>(spec.kind) : null;
    const bodies = waterBodiesWith<Mount>(spec.kind);
    const mounts = onWater ? bodies : base ? [{ params: base }] : featureMounts<Mount>(spec.kind);
    const distance = farthest(mounts, "renderDistance", spec.defaultRenderDistance);
    const groups: KnobGroup<Knobs>[] = [];
    for (const m of mounts) {
      const knobs = knobsOf(m.params);
      const key = JSON.stringify(knobs);
      let group = groups.find((g) => JSON.stringify(g.knobs) === key);
      if (!group) groups.push((group = { knobs, bodies: [] }));
      if ("slot" in m) group.bodies.push({ slot: m.slot, zone: m.params.zone ?? WATER_ZONE_DEFAULTS.particle });
    }
    const requests = groups.map((g) => ({ knobs: g.knobs, args: argsOf(g) }));
    const assets = useChunkAssets(
      () => {
        const materials = spec.layers.map((layer) => selfPatchedMaterial(createParticleMaterial(layer.look)));
        return { layers: { materials, dispose: () => materials.forEach((m) => m.dispose()) } };
      },
      (a) => a.layers.materials.map((m) => meshTemplate(m.material)),
    );
    const groupRef = useWorldChunks({
      renderDistance: distance,
      build: async (bounds) => {
        const writers = spec.layers.map(() => new ParticleWriter());
        const travel = spec.layers.map(() => 0);
        let any = false;
        for (const { knobs, args } of requests) {
          const emitters = await enumerateDressing(spec.enumerator, bounds, args);
          if (emitters.length === 0) continue;
          any = true;
          spec.layers.forEach((layer, i) => {
            for (const e of emitters) layer.emit(e, writers[i], knobs);
            travel[i] = Math.max(travel[i], layer.maxTravel(knobs));
          });
        }
        if (!any) return null;
        const meshes: THREE.Mesh[] = [];
        spec.layers.forEach((layer, i) => {
          const mesh = buildParticleChunk(writers[i], bounds, assets.layers.materials[i].material, travel[i], layer.renderOrder);
          if (mesh) meshes.push(mesh);
        });
        if (meshes.length === 0) return null;
        if (meshes.length === 1) return meshes[0];
        const group = new THREE.Group();
        for (const mesh of meshes) group.add(mesh);
        return group;
      },
    });
    useFrame(({ clock }) => tickParticles(clock.elapsedTime));
    return <group ref={groupRef} />;
  };
  Particles.displayName = spec.kind;
  return declare<Mount>({
    kind: spec.kind,
    within: spec.within === "waterBody" ? WATER_BODY_KINDS : spec.within === "channelBody" ? CHANNEL_BODY_KINDS : spec.within,
    read: (node) => ({ ...node.props }),
    Driver: Particles,
  });
};
