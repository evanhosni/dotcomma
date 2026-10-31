import type { ReactElement, ReactNode } from "react";

/**
 * THE CONTENT TREE: the single description of a world, written as JSX and read two ways — React
 * renders it for the player, and a Three-free walker (index.ts) reads the same elements as DATA for
 * the workers and the server. There is no second spec list: presence in this tree IS the content
 * (CLAUDE.md "Presence by mounting"), a knob is a prop, and a part is a child.
 */

/** What one declaration component contributes. `kind` is its tag in the walked tree. */
export interface ContentDeclaration<P = Record<string, unknown>> {
  kind: string;
  /** The kind(s) it may be mounted inside; null = top level only; omitted = anywhere (an <Actor>
   *  stands in a biome or inside one of its features, and its path says which). */
  within?: string | readonly string[] | null;
  /** Mounted ONCE by <Domain> when any node of this kind is in the tree — the system that draws
   *  every one of them (its registrations carry which biome asked). Unset = nothing to draw. */
  Driver?: () => ReactElement | null;
  /** The element React renders in place of the declaration. Unset = nothing (the Driver draws it). */
  View?: (props: P & { children?: ReactNode }) => ReactElement | null;
  /** This declaration's RESOLVED params for the config the workers and the server read (its own
   *  defaults applied, its children folded in). Unset = the mounting alone is the whole fact. */
  read?: (node: ContentNode<P>) => unknown;
}

/** A declaration component: renders its View (or nothing) and carries its declaration for the walker. */
export type ContentComponent<P> = ((props: P & { children?: ReactNode }) => ReactElement | null) & {
  content: ContentDeclaration<P>;
};

/** One mounted declaration, as the walker reads it. */
export interface ContentNode<P = Record<string, unknown>> {
  kind: string;
  /** The declaration the mounted component carries — where its Driver and View come from, so
   *  nothing anywhere keeps a list of kinds. */
  decl: ContentDeclaration<any>;
  /** Dotted from the top: `region.biome.sewers.rooms`. Its last segment is `kind`. */
  path: string;
  /** Its props, minus `children`. */
  props: P;
  /** The declarations mounted inside it, in JSX order — which is VORONOI order for regions and biomes. */
  children: ContentNode<any>[];
}
