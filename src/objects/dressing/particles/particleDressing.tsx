import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildParticleChunk, ParticleWriter } from "../../../particles/particleChunk";
import { createParticleMaterial, tickParticles, type ParticleLook } from "../../../particles/particleMaterial";
import { meshTemplate } from "../../../utils/warmPrograms";
import { selfPatchedMaterial, useDomainWideDressing, useDressingAssets, useDressingChunks, useDressingDefault } from "../Dressing";
import { enumerateDressing } from "../dressingWorker";
import type { DressingEnumeratorName, EnumeratorArgs, EnumeratorPoint } from "../enumerators";

/**
 * A particle DRESSING member on the particle base (src/particles/): its emitter enumerator with the
 * args the one mount uses, and one or more LAYERS drawn from every emitter — each a look, how the
 * emitter's particles of that look are written (seeded from the emitter's position, so a chunk
 * rebuilds identically), the farthest they fly and the render order. Everything else (the
 * domain-wide mount check, each look's material on the base's assets with its warm template, the
 * base's chunk lifecycle over the enumerator, one mesh per layer per chunk, the clock) is here, once.
 */
export interface ParticleLayer<K extends DressingEnumeratorName> {
  look: ParticleLook;
  emit: (emitter: EnumeratorPoint<K>, writer: ParticleWriter) => void;
  /** The farthest a particle flies from its origin (the culling sphere's pad). */
  maxTravel: number;
  renderOrder: number;
}

export interface ParticleDressingSpec<K extends DressingEnumeratorName> {
  /** The component's name (the domain-wide mount check names it). */
  name: string;
  enumerator: K;
  emitters: EnumeratorArgs<K>;
  layers: ParticleLayer<K>[];
  defaultRenderDistance: number;
}

export const createParticleDressing = <K extends DressingEnumeratorName>(spec: ParticleDressingSpec<K>) => {
  const Particles = ({ renderDistance }: { renderDistance?: number }) => {
    useDomainWideDressing(spec.name);
    const distance = useDressingDefault("renderDistance", renderDistance, spec.defaultRenderDistance);
    const assets = useDressingAssets(
      () => {
        const materials = spec.layers.map((layer) => selfPatchedMaterial(createParticleMaterial(layer.look)));
        return { layers: { materials, dispose: () => materials.forEach((m) => m.dispose()) } };
      },
      (a) => a.layers.materials.map((m) => meshTemplate(m.material)),
    );
    const groupRef = useDressingChunks({
      renderDistance: distance,
      build: async (bounds) => {
        const emitters = await enumerateDressing(spec.enumerator, bounds, spec.emitters);
        if (emitters.length === 0) return null;
        const meshes: THREE.Mesh[] = [];
        spec.layers.forEach((layer, i) => {
          const writer = new ParticleWriter();
          for (const e of emitters) layer.emit(e, writer);
          const mesh = buildParticleChunk(writer, bounds, assets.layers.materials[i].material, layer.maxTravel, layer.renderOrder);
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
  Particles.displayName = spec.name;
  return Particles;
};
