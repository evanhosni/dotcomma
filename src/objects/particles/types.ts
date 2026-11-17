import { ParticleWriter } from "./ParticleWriter";
import type { ParticleLook } from "./material";
import type { WaterZone, ZonedBody } from "../../generation/water/types";
import type { DressingEnumeratorName, EnumeratorArgs, EnumeratorPoint } from "../dressing/types";

/**
 * A particle DRESSING member on the particle base (src/particles/): its emitter enumerator, the KNOBS a
 * mount may tune (its props, each with a default), and one or more LAYERS drawn from every emitter — each
 * a look, how the emitter's particles of that look are written (seeded from the emitter's position, so a
 * chunk rebuilds identically), the farthest they fly and the render order. Everything else (the mounts'
 * knobs, each look's material on the base's assets with its warm template, the base's chunk lifecycle
 * over the enumerator, one mesh per layer per chunk, the clock) is here, once.
 */
interface ParticleLayer<K extends DressingEnumeratorName, Knobs> {
  look: ParticleLook;
  emit: (emitter: EnumeratorPoint<K>, writer: ParticleWriter, knobs: Knobs) => void;
  /** The farthest a particle flies from its origin (the culling sphere's pad). */
  maxTravel: (knobs: Knobs) => number;
  renderOrder: number;
}

export interface ParticleProps {
  renderDistance?: number;
  /** Mounted in a body of water: the zone its emitters stand in (default WATER_ZONE_DEFAULTS.particle). */
  zone?: WaterZone;
}

export interface ParticleDressingSpec<K extends DressingEnumeratorName, Knobs extends object> {
  /** Its kind in the content tree, and the seed namespace of its chunks. */
  kind: string;
  /** Where it may be mounted: a biome for something that belongs to one, the domain's <Water> for
   *  what follows every water (a fall's spray), a BODY of water (<Lake>, <Rivers>, <Pond>) for a part
   *  of it (a lake's bubbles), or only a CHANNEL body (<Rivers>, <Pond>: what rises off their ponds) — in a
   *  body its enumerator gets the mounting bodies, each with its zone, as `bodies`. */
  within: "biome" | "water" | "waterBody" | "channelBody";
  enumerator: K;
  /** What a mount may tune, with its defaults (literal props: the server reads the tree). */
  knobs: Knobs;
  /** The enumerator's args for a mount's knobs. */
  emitters: (knobs: Knobs) => Omit<EnumeratorArgs<K>, "bodies" | "seedTag">;
  /** In a body: the namespace its emitters' scatter is seeded by. A group of mounts whose knobs differ
   *  from the defaults seeds by its knobs too, so two overlapping bodies with different knobs never emit
   *  the same points twice. */
  seedTag?: string;
  layers: ParticleLayer<K, Knobs>[];
  defaultRenderDistance: number;
}

/** Mounts that agree on every knob share one enumeration: each group's knobs, and its bodies of water. */
export interface KnobGroup<Knobs> {
  knobs: Knobs;
  bodies: ZonedBody[];
}
