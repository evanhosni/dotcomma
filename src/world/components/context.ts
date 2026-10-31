import { createContext, useContext } from "react";

/** Where a view is mounted in the content tree. A biome's own components read it so they never
 *  have to be told which biome they are in (<GrassField> spawns in the biome it is mounted in). */
export const RegionContext = createContext<{ regionId: number; name: string } | null>(null);
export const BiomeContext = createContext<{ biomeId: number; name: string } | null>(null);

/** The biome a view is mounted in; throws for a view that may not stand outside one. */
export const useBiome = (component: string): { biomeId: number; name: string } => {
  const biome = useContext(BiomeContext);
  if (!biome) throw new Error(`<${component}> must be mounted inside a <Biome>`);
  return biome;
};

/** Bumped when the domain has committed: systems that read the active domain mount after it. */
export const DomainReadyContext = createContext(false);
export const useDomainReady = (): boolean => useContext(DomainReadyContext);
