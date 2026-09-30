import React, { useLayoutEffect, useMemo } from "react";
import type { BiomeSpec, RegionSpec } from "../types";
import { BiomeSlotContext, RegionContext, RegionSlotContext, reportHierarchyError, useDomainStore, useSpecSlot } from "./context";

/** Components keyed by spec `name`; `null` = the spec needs no client content (config only). */
export type SpecComponents = Readonly<Record<string, React.ComponentType | null>>;

/** Renders one component per spec, IN SPEC ORDER, each inside the slot its <Region>/<Biome> asserts. */
const renderSpecSlots = <S extends { id: number; name: string }>(
  specs: readonly S[],
  components: SpecComponents,
  Slot: React.Provider<S | null>,
  where: string,
): JSX.Element[] => {
  const names = specs.map((s) => s.name);
  const missing = names.filter((n) => !(n in components));
  const extra = Object.keys(components).filter((n) => !names.includes(n));
  if (missing.length || extra.length) {
    reportHierarchyError(
      `${where}: the component map must have exactly one entry per spec name` +
        (missing.length ? ` — missing ${missing.join(", ")}` : "") +
        (extra.length ? ` — not in the spec list: ${extra.join(", ")}` : ""),
    );
  }
  return specs.map((spec) => {
    const Component = components[spec.name];
    return <Slot key={spec.id} value={spec}>{Component ? <Component /> : null}</Slot>;
  });
};

export interface RegionsProps {
  /** Voronoi order — the domain's one region list (the same array its config.ts reads). */
  specs: readonly RegionSpec[];
  /** Each region's component by region `name`. */
  components: SpecComponents;
}

/** The domain's regions, rendered from its spec list. */
export const Regions = ({ specs, components }: RegionsProps) => (
  <>{renderSpecSlots(specs, components, RegionSlotContext.Provider, "<Regions>")}</>
);

export interface RegionProps extends React.PropsWithChildren {
  /** The region folder's `spec.ts`: everything the server's config reads (id, name, base noise, blend widths, biome order). */
  spec: RegionSpec;
  /** Each biome's component by biome `name`, rendered in `spec.biomes` order. */
  biomes: SpecComponents;
}

/** A group of biomes on ONE base terrain (`spec.baseNoise`) under one base material (its
 *  `<Material>`) and sky. Regions have NO boundary of their own: they cross-fade into their
 *  neighbors (CLAUDE.md "Blending"). */
export const Region = ({ spec, biomes, children }: RegionProps) => {
  const store = useDomainStore("Region");
  useSpecSlot(RegionSlotContext, spec, "Region", "the domain's <Regions components>");
  const { id } = spec;

  useLayoutEffect(() => {
    const { name, baseNoise, blendWidth, heightBlendWidth, riverProbability } = spec;
    store.regions.set(id, { id, name, baseNoise, blendWidth, heightBlendWidth, riverProbability });
    store.invalidate();
    return () => {
      store.regions.delete(id);
      store.invalidate();
    };
  }, [store, id, spec]);

  const ctx = useMemo(() => ({ regionId: id }), [id]);

  return (
    <RegionContext.Provider value={ctx}>
      {children}
      {renderSpecSlots<BiomeSpec>(spec.biomes, biomes, BiomeSlotContext.Provider, `<Region spec={${spec.name}}> biomes`)}
    </RegionContext.Provider>
  );
};
