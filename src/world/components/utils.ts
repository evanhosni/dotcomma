import { ACTOR_COMPONENTS } from "../../objects/actors/registry";
import { actorAttributesOf, mountOverridesOf, specNeedsServer } from "../../objects/actors/spec";
import type { ActorMount, ActorSpec } from "../../objects/actors/spec";
import type { AnyActorDescriptor } from "../../objects/actors/spawning/types";
import { reportContentError } from "../../utils/utils";
import { _material } from "../../utils/render/material";
import type { MaterialData } from "../types";
import type { MaterialProps } from "./Material";

const DESCRIPTOR_OF_SPEC = new WeakMap<ActorSpec, AnyActorDescriptor>();

/** The client descriptor of a spec (cached per spec): the member component the spec names
 *  (objects/actors/registry.ts, default ModelActor) plus every spec attribute. */
export const describeActor = (spec: ActorSpec): AnyActorDescriptor => {
  const cached = DESCRIPTOR_OF_SPEC.get(spec);
  if (cached) return cached;
  const component = ACTOR_COMPONENTS[spec.component ?? "model"];
  if (component === ACTOR_COMPONENTS.model && !spec.model) {
    reportContentError(`[actors] "${spec.id}" renders as a GLTF model but its spec sets no \`model\` (or a \`component\`).`);
  }
  // A kind the server has nothing to simulate would only register an entity for nothing.
  const localOnly = specNeedsServer(spec) ? {} : { serverSynced: false };
  const descriptor = { component, ...localOnly, ...actorAttributesOf(spec) } as unknown as AnyActorDescriptor;
  DESCRIPTOR_OF_SPEC.set(spec, descriptor);
  return descriptor;
};

/** One mounted <Actor> as a spawn descriptor: the spec's attributes, the mount's overrides, the
 *  biome it stands in and — for a feature-placed one — the feature that places it. */
export const descriptorOfMount = (mount: ActorMount, id: string, biomeId: number, feature: string): AnyActorDescriptor => ({
  ...describeActor(mount.actor),
  ...(mountOverridesOf(mount) as Partial<AnyActorDescriptor>),
  id,
  biomeIds: [biomeId],
  ...(feature ? { feature } : {}),
});

const BUILDERS = new WeakMap<object, () => Promise<MaterialData>>();

/** "#rrggbb" → a fragment shader painting it. */
const flatColorShader = (hex: string): string => {
  const channel = (i: number) => (parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255).toFixed(4);
  return `void main() { gl_FragColor = vec4(${channel(0)}, ${channel(1)}, ${channel(2)}, 1.0); }`;
};

/** A <Material>'s builder: its own `getMaterial`, else one assembled from its shader + textures or its
 *  color (memoized per props object, which is stable while its element is). */
export const materialBuilderOf = (props: MaterialProps): (() => Promise<MaterialData>) | undefined => {
  if (props.getMaterial) return props.getMaterial;
  const shader = props.shader ?? (props.color && flatColorShader(props.color));
  if (shader === undefined) return undefined;
  const cached = BUILDERS.get(props);
  if (cached) return cached;
  const builder = _material.fromShader(shader, props.textures ?? {});
  BUILDERS.set(props, builder);
  return builder;
};
