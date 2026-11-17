import { childOfKind } from "../content";
import type { ContentNode } from "../content/types";

/** A tunnel feature's part of `kind` with its defaults under its props, or null where none is mounted. */
export const partOf = <T extends object>(node: ContentNode<any>, kind: string, defaults: T): T | null => {
  const part = childOfKind<Partial<T>>(node, kind);
  return part ? { ...defaults, ...part.props } : null;
};
