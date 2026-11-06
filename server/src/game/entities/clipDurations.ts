import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClipDurations } from "../../../../src/animation";
import { glbClipDurations, proceduralDurations } from "../../../../src/animation/utils";
import type { ActorSpec } from "../../../../src/objects/actors/spec";

// The bundle is one file one level below server/ (dist/ or dist-test/), like http.ts's client build.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL_ROOTS = ["public", "build"].map((dir) => path.join(REPO_ROOT, dir));

const cache = new Map<string, ClipDurations>();

const modelDurations = (model: string): ClipDurations => {
  for (const root of MODEL_ROOTS) {
    try {
      return glbClipDurations(readFileSync(path.join(root, model)));
    } catch {}
  }
  console.warn(`[entities] no clip durations for ${model}: reversing a finished one-shot clip will not clamp`);
  return {};
};

/** What the server's animation channel needs to clamp one-shots: the model's clips and the procedural ones. */
export const clipDurationsOf = (spec: ActorSpec): ClipDurations => {
  let durations = cache.get(spec.id);
  if (!durations) {
    durations = { ...(spec.model ? modelDurations(spec.model) : {}), ...proceduralDurations(spec.animation?.procedural) };
    cache.set(spec.id, durations);
  }
  return durations;
};
