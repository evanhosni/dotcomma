import type { RiverbedMaterial } from "../../../../types";

/** Cold gravel under the snow region's rivers (tundra and mountain): the mountain's dirt, grayed
 *  and cooled — the domain's sand would read as a beach in the snow. */
export const SNOW_RIVERBED: RiverbedMaterial = { texture: "dirt.png", saturation: 0.3, tint: [0.9, 0.93, 1.0] };
