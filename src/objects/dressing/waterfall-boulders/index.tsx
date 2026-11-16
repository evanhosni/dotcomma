import * as THREE from "three";
import { traceSpan } from "../../../utils/spikeTrace";
import { meshTemplate } from "../../../utils/warmPrograms";
import { waterBasePart } from "../../../utils/workers/water/params";
import { WATERFALL_BOULDER_DEFAULTS, WATERFALL_BOULDERS, type WaterfallBouldersParams } from "../../../utils/workers/water/parts/boulders";
import { declare } from "../../../world/content";
import { selfPatchedMaterial, type SolidDressingProps, useChunkAssets, useSolidDressing } from "..";
import { buildRockMesh } from "../rocks/geometry";
import { createRockMaterial } from "../rocks/material";
import { ROCK_COLLIDER_DISTANCE, ROCK_RENDER_DISTANCE } from "../rocks/spec";
import { WATERFALL_BOULDERS_SPEC } from "./spec";

export interface WaterfallBouldersProps extends SolidDressingProps, Partial<WaterfallBouldersParams> {}

/** BOULDERS in every river (emitters: utils/workers/water/parts/boulders.ts) — dense in a FALL (the
 *  <Water> base's `fallGrade`), the odd one in calm water — where the fall's spray bursts on them
 *  (<WaterfallSplashes/>). Rivers cross every region: mounted once, in the domain's <Water>; unmounted,
 *  there are none, on the client and the server alike. Drawn and collided as rocks (rocks/). */
export const WaterfallBoulders = declare<WaterfallBouldersProps>({
  kind: WATERFALL_BOULDERS,
  within: "water",
  read: (node) => ({ ...WATERFALL_BOULDER_DEFAULTS, ...node.props }),
  Driver: () => <WaterfallBouldersDriver />,
});

const WaterfallBouldersDriver = () => {
  const mount = waterBasePart<WaterfallBouldersProps>(WATERFALL_BOULDERS);
  const assets = useChunkAssets(
    () => ({ rock: selfPatchedMaterial(createRockMaterial()) }),
    (a) => [meshTemplate(a.rock.material)],
  );
  const { content } = useSolidDressing(WATERFALL_BOULDERS_SPEC, {
    renderDistance: mount?.renderDistance ?? ROCK_RENDER_DISTANCE,
    colliderDistance: mount?.colliderDistance ?? ROCK_COLLIDER_DISTANCE,
    build: (rocks, _bodies, bounds) =>
      traceSpan("waterfallBoulders:chunk", () => {
        const group = new THREE.Group();
        group.add(buildRockMesh(rocks, bounds, assets.rock.material));
        return { group };
      }),
  });
  return content;
};
