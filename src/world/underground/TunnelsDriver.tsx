import type { TunnelStyle } from "../../generation/underground/types";
import type { ChunkViewProps } from "../chunks/types";
import { featureMounts } from "../../generation/registry";
import { UndergroundForBiome } from "./UndergroundForBiome";

/** One chunk lifecycle per biome that mounted the style. */
export const TunnelsDriver = ({ tunnel, kind }: { tunnel: TunnelStyle; kind: string }) => (
  <>
    {featureMounts<TunnelProps>(kind).map(({ biomeId, params }) => (
      <UndergroundForBiome
        key={biomeId}
        tunnel={tunnel}
        biomeId={biomeId}
        renderDistance={params.renderDistance}
        colliderDistance={params.colliderDistance}
      />
    ))}
  </>
);

export interface TunnelProps extends ChunkViewProps {
  /** The chance a cell of the biome holds a system. */
  chance?: number;
}
