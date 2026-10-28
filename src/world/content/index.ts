import type { ReactElement, ReactNode } from "react";
import { reportContentError } from "../../utils/contentError";
import type { ContentComponent, ContentDeclaration, ContentNode } from "./types";

export type { ContentComponent, ContentDeclaration, ContentNode } from "./types";

/**
 * Declaring and reading the content tree (types.ts has the shape).
 *
 * The walker NEVER CALLS a component: it reads `props.children` down the element objects, so a view
 * with hooks in the tree is simply walked past, and the server can read a tree whose views import
 * Three (its build stubs Three away — server/src/content/). Content FILES therefore export a static
 * element wrapped by `content()`, never a function that builds one.
 */

/** A declaration component: `<Snow/>`, `<Biome>`, `<Sewers>`. Mounting it IS the content. */
export const declare = <P extends object>(decl: ContentDeclaration<P>): ContentComponent<P> => {
  const Component = (props: P & { children?: ReactNode }) => (decl.View ? decl.View(props) : null);
  Component.displayName = decl.kind;
  return Object.assign(Component, { content: decl as ContentDeclaration<P> });
};

/** A content file's export: a static element, usable as `<CityBiome/>` and readable by the walker.
 *  (A function component would have to be CALLED to reach its children, which hooks forbid.) */
export const content = (element: ReactElement): (() => ReactElement) =>
  Object.assign(() => element, { element });

const FRAGMENT = Symbol.for("react.fragment");
const MEMO = Symbol.for("react.memo");
const FORWARD_REF = Symbol.for("react.forward_ref");

type AnyElement = ReactElement<{ children?: ReactNode }>;

/** The element a type stands for: a `content()` export renders a fixed element; memo/forwardRef wrap one. */
const unwrap = (type: unknown): unknown => {
  const t = type as { element?: ReactElement; $$typeof?: symbol; type?: unknown; render?: unknown };
  if (t?.element) return t.element;
  if (t?.$$typeof === MEMO) return t.type;
  if (t?.$$typeof === FORWARD_REF) return t.render;
  return null;
};

const declarationOf = (type: unknown): ContentDeclaration | null =>
  (type as { content?: ContentDeclaration } | null)?.content ?? null;

/** `within` omitted = anywhere; null = only at the root; a name or list = inside one of those. */
const mountedCorrectly = (decl: ContentDeclaration, parent: ContentNode | null): boolean => {
  const { within } = decl;
  if (within === undefined) return true;
  if (within === null) return parent === null;
  return parent !== null && [within].flat().includes(parent.kind);
};

const walk = (node: ReactNode, parent: ContentNode | null, out: ContentNode[]): void => {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, parent, out);
    return;
  }
  if (typeof node !== "object" || !("type" in node)) return;
  const element = node as AnyElement;
  const { type } = element;

  if ((type as unknown) === FRAGMENT) {
    walk(element.props.children, parent, out);
    return;
  }

  const decl = declarationOf(type);
  if (!decl) {
    // A view, a host element or a plain wrapper: not content itself, but its children may be.
    const inner = unwrap(type);
    if (inner) walk(inner as ReactNode, parent, out);
    else walk(element.props.children, parent, out);
    return;
  }

  if (!mountedCorrectly(decl, parent)) {
    const within = decl.within;
    reportContentError(
      within === null
        ? `<${decl.kind}> is top level: it cannot be mounted inside <${parent!.kind}>`
        : `<${decl.kind}> must be mounted inside ${[within].flat().map((w) => `<${w}>`).join(" or ")} ` +
          `(found it in ${parent ? `<${parent.kind}>` : "the root"})`,
    );
    return;
  }

  const { children, ...props } = element.props as Record<string, unknown> & { children?: ReactNode };
  const self: ContentNode = { kind: decl.kind, decl, path: parent ? `${parent.path}.${decl.kind}` : decl.kind, props, children: [] };
  walk(children, self, self.children);
  out.push(self);
};

const walked = new WeakMap<object, ContentNode[]>();

/** The declarations mounted in a subtree, in JSX order (memoized per element). */
export const readContent = (node: ReactNode): ContentNode[] => {
  if (node === null || typeof node !== "object") {
    const out: ContentNode[] = [];
    walk(node, null, out);
    return out;
  }
  let tree = walked.get(node);
  if (!tree) {
    tree = [];
    walk(node, null, tree);
    walked.set(node, tree);
  }
  return tree;
};

const nodes = new WeakMap<object, ContentNode<any>>();

/** The node a declaration's own View stands for, from inside it: the element it was mounted as is
 *  out of reach there, so the children are walked under a node built here. Identical to what the
 *  walker produces for the same element (memoized per children object). */
export const nodeOf = <P extends object>(decl: ContentDeclaration<P>, props: P, children: ReactNode): ContentNode<P> => {
  const key = (children ?? decl) as object;
  const cached = nodes.get(key);
  if (cached && cached.kind === decl.kind) return cached as ContentNode<P>;
  const node: ContentNode<P> = { kind: decl.kind, decl, path: decl.kind, props, children: [] };
  walk(children, node as ContentNode<any>, node.children);
  if (typeof key === "object") nodes.set(key, node as ContentNode<any>);
  return node;
};

/** Every node of a kind in a subtree, at any depth, in JSX order. */
export const nodesOfKind = (nodes: readonly ContentNode<any>[], kind: string): ContentNode[] => {
  const out: ContentNode[] = [];
  const visit = (n: ContentNode<any>): void => {
    if (n.kind === kind) out.push(n);
    n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return out;
};

/** The one child of a kind, or null where it is not mounted. */
export const childOfKind = <P = Record<string, unknown>>(node: ContentNode<any>, kind: string): ContentNode<P> | null =>
  (node.children.find((c) => c.kind === kind) as ContentNode<P> | undefined) ?? null;

/** Every child of a kind, in JSX order. */
export const childrenOfKind = <P = Record<string, unknown>>(node: ContentNode<any>, kind: string): ContentNode<P>[] =>
  node.children.filter((c) => c.kind === kind) as ContentNode<P>[];

export interface MountedDriver {
  kind: string;
  Driver: () => ReactElement | null;
}

/** The DRIVERS of every kind mounted in a subtree, one per kind, in first-seen order: <Domain>
 *  mounts exactly these, so a system exists because something declared it and for no other reason. */
export const driversIn = (nodes: readonly ContentNode<any>[]): MountedDriver[] => {
  const byKind = new Map<string, MountedDriver>();
  const visit = (n: ContentNode<any>): void => {
    if (n.decl.Driver && !byKind.has(n.kind)) byKind.set(n.kind, { kind: n.kind, Driver: n.decl.Driver });
    n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return [...byKind.values()];
};
