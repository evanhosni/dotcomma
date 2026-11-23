import { useEffect } from "react";
import { reportContentError } from "../../utils/utils";
import { IS_DEV } from "../../utils/constants";

/** Mounted fields per seed, by plant type: two plant types on one seed (at one density) land on
 *  identical points and grow through each other. */
const plantsBySeed = new Map<string, Map<object, number>>();

export const usePlantSeed = (seed: string, plant: object | undefined): void => {
  useEffect(() => {
    if (!plant || !IS_DEV) return;
    let plants = plantsBySeed.get(seed);
    if (!plants) plantsBySeed.set(seed, (plants = new Map()));
    if ([...plants.keys()].some((other) => other !== plant)) {
      reportContentError(`[foliage] two different plant types are mounted with seed "${seed}" — they would place on the same points. Give each createFoliage its own seed.`);
    }
    plants.set(plant, (plants.get(plant) ?? 0) + 1);
    return () => {
      const left = (plants!.get(plant) ?? 1) - 1;
      if (left > 0) plants!.set(plant, left);
      else plants!.delete(plant);
    };
  }, [seed, plant]);
};
