import type { FC, ReactElement } from "react";
import { CavesView, SewersView } from "../../objects/dressing/underground/Underground";
import { reportContentError } from "../../utils/contentError";
import { featureSpawnsOf, featureTreeOf } from "../features";
import { ActorMounts } from "./Actor";

/** Each top-level feature's client view, by name; a part has none (its feature's view draws it). */
const FEATURE_VIEWS: Record<string, FC<Record<string, unknown>>> = {
  sewers: SewersView,
  caves: CavesView,
};

/** A biome spec's `features` on the client (rendered by <Biome>): every top-level feature's view with
 *  its props, and every <Spawn> as its own actor listing, placed by its feature (spawn.worker.ts). */
export const Features = ({ features }: { features: ReactElement }) => {
  const tree = featureTreeOf(features);
  return (
    <>
      {tree.map((f) => {
        const View = FEATURE_VIEWS[f.name];
        if (!View) reportContentError(`the "${f.name}" feature has no view in world/components/Features.tsx`);
        return View ? <View key={f.path} {...f.params} /> : null;
      })}
      {featureSpawnsOf(tree).map(({ path, mount }) => (
        <ActorMounts key={`${path}/${mount.actor.id}`} mounts={[mount]} feature={path} />
      ))}
    </>
  );
};
