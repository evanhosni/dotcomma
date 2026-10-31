/** The sewers per city district: every chunk, the spawn worker and the server merge the SAME systems of a
 *  district into its one layout (sewers.ts mergeLayouts), so the rooms they each find agree. Three-free. */

import type { RectXZ } from "../../math/types";
import { CITY_WIGGLE_AMP, cityDistrictByIndex } from "../roads/cityDistricts";
import { mergeLayouts, sideRoomOf, type SewerLayout } from "./sewers";
import { systemsNear } from "./systems";
import type { TunnelSystem } from "./types";

/** Every system of a district (the whole district's area, so every caller merges the same set). */
const districtSystems = (biomeId: number, district: string, sample: TunnelSystem): TunnelSystem[] => {
  const [r, m] = district.split(",").map(Number);
  const d = cityDistrictByIndex(r, m);
  const area = { minX: d.minX - CITY_WIGGLE_AMP, minZ: d.minZ - CITY_WIGGLE_AMP, maxX: d.maxX + CITY_WIGGLE_AMP, maxZ: d.maxZ + CITY_WIGGLE_AMP };
  const all = systemsNear("sewer", biomeId, area, 0).filter((s) => s.district === district);
  if (!all.includes(sample)) all.push(sample);
  return all;
};

/** The merged layout of every district with a system reaching the area padded by `pad`, by district key. */
export const districtLayoutsNear = (biomeId: number, area: RectXZ, pad: number): Map<string, SewerLayout> => {
  const samples = new Map<string, TunnelSystem>();
  for (const s of systemsNear("sewer", biomeId, area, pad)) if (s.district && !samples.has(s.district)) samples.set(s.district, s);
  const out = new Map<string, SewerLayout>();
  for (const [district, sample] of samples) out.set(district, mergeLayouts(district, districtSystems(biomeId, district, sample)));
  return out;
};

/** The floor centre of every sewer side room whose centre lies in the area (what a <Spawn> inside
 *  <SewerSideRoom> stands one actor on). */
export const sewerSideRoomsIn = (biomeId: number, area: RectXZ): { x: number; z: number; floor: number }[] => {
  const out: { x: number; z: number; floor: number }[] = [];
  for (const layout of districtLayoutsNear(biomeId, area, 0).values()) {
    for (const n of layout.nodes.values()) {
      if (n.door < 0) continue;
      const { cx, cz } = sideRoomOf(layout.district, n, n.door);
      if (cx >= area.minX && cx < area.maxX && cz >= area.minZ && cz < area.maxZ) out.push({ x: cx, z: cz, floor: n.floor });
    }
  }
  return out;
};
