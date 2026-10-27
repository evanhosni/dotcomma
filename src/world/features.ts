import type { ReactElement, ReactNode } from "react";
import type { ActorMount } from "../objects/actors/spec";
import { reportContentError } from "../utils/contentError";

/**
 * THE FEATURE TREE: what a biome spec's `features` holds, written as JSX of DECLARATION components that
 * render nothing — `<Sewers chance={0.75}><SewerSideRoom><Spawn actor={BEEBLE_SPEC} /></SewerSideRoom></Sewers>`.
 * A feature exists because it is in the tree, a part because it is inside its feature, a knob because it
 * is a prop (CLAUDE.md "Presence by mounting"). The tree is DATA: the spec is what the server and every
 * worker read, so this module walks the element objects without rendering them (Three-free; React only
 * for its element types). <Biome> draws each top-level feature's client view (world/components/Features.tsx).
 */

export interface FeatureDeclaration {
  /** Unique among its siblings: the last segment of the feature's path. */
  name: string;
  /** The name of the feature it must be mounted inside, or null for a top-level feature. */
  parent: string | null;
}

export type FeatureComponent<P> = ((props: P & { children?: ReactNode }) => null) & { feature: FeatureDeclaration };

export const defineFeature = <P extends object>(name: string, parent: string | null = null): FeatureComponent<P> =>
  Object.assign((_: P & { children?: ReactNode }) => null, { feature: { name, parent } });

/** An actor placed BY the feature it is mounted inside (each feature says where: a sewer side room's
 *  centre), with the same per-mount overrides as a spec's `actors` entry. */
export const Spawn = Object.assign((_: ActorMount) => null, { spawn: true as const });

export interface FeatureNode {
  name: string;
  /** Dotted from the top-level feature: `sewers`, `sewers.sideRooms`. */
  path: string;
  /** Its props, minus `children`. */
  params: Record<string, unknown>;
  parts: FeatureNode[];
  spawns: ActorMount[];
}

const FRAGMENT = Symbol.for("react.fragment");
const trees = new WeakMap<object, FeatureNode[]>();

const walk = (node: ReactNode, parent: FeatureNode | null, out: FeatureNode[]): void => {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, parent, out);
    return;
  }
  if (typeof node !== "object" || !("type" in node)) {
    reportContentError(`a biome's \`features\` holds only feature components and <Spawn> (found ${JSON.stringify(node)})`);
    return;
  }
  const el = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  if ((el.type as unknown) === FRAGMENT) {
    walk(el.props.children, parent, out);
    return;
  }
  const type = el.type as Partial<typeof Spawn & FeatureComponent<object>>;
  if (type.spawn) {
    if (parent) parent.spawns.push(el.props as unknown as ActorMount);
    else reportContentError(`<Spawn> must be mounted inside a feature (a top-level actor goes in the spec's \`actors\`)`);
    return;
  }
  const decl = type.feature;
  if (!decl) {
    reportContentError(`a biome's \`features\` holds only feature components and <Spawn>`);
    return;
  }
  if (decl.parent !== (parent?.name ?? null)) {
    reportContentError(
      decl.parent
        ? `the "${decl.name}" feature must be mounted inside the "${decl.parent}" feature`
        : `the "${decl.name}" feature is top-level: it cannot be mounted inside "${parent!.path}"`,
    );
    return;
  }
  const { children, ...params } = el.props;
  const feature: FeatureNode = { name: decl.name, path: parent ? `${parent.path}.${decl.name}` : decl.name, params, parts: [], spawns: [] };
  walk(children, feature, feature.parts);
  if (out.some((f) => f.name === feature.name)) reportContentError(`the "${feature.path}" feature is mounted twice in one place`);
  out.push(feature);
};

/** The tree of a biome spec's `features` (memoized per element). */
export const featureTreeOf = (features: ReactNode | undefined): FeatureNode[] => {
  if (features === null || typeof features !== "object") {
    const out: FeatureNode[] = [];
    walk(features, null, out);
    return out;
  }
  let tree = trees.get(features);
  if (!tree) {
    tree = [];
    walk(features, null, tree);
    trees.set(features, tree);
  }
  return tree;
};

/** The feature at a dotted path, or null where it is not mounted. */
export const findFeature = (tree: readonly FeatureNode[], path: string): FeatureNode | null => {
  let level: readonly FeatureNode[] = tree;
  let found: FeatureNode | null = null;
  for (const name of path.split(".")) {
    found = level.find((f) => f.name === name) ?? null;
    if (!found) return null;
    level = found.parts;
  }
  return found;
};

/** Every <Spawn> in the tree, with the path of the feature that places it. */
export const featureSpawnsOf = (tree: readonly FeatureNode[]): { path: string; mount: ActorMount }[] => {
  const out: { path: string; mount: ActorMount }[] = [];
  const visit = (f: FeatureNode): void => {
    for (const mount of f.spawns) out.push({ path: f.path, mount });
    f.parts.forEach(visit);
  };
  tree.forEach(visit);
  return out;
};

/** A feature-placed kind's descriptor id (also its entity `kind`): its own listing, apart from the
 *  biome's density-placed one, cataloged under it (objects/actors/catalog.ts). */
export const featureSpawnId = (actorId: string, path: string): string => `${actorId}@${path}`;
