import { Biome } from "../../world/types";
import { ApartmentDescriptor } from "./blocks/apartment/descriptor";
import { Building1Descriptor } from "./blocks/building1/descriptor";
import { BeebleDescriptor } from "./creatures/beeble/descriptor";
import { BigBeebleDescriptor } from "./creatures/big-beeble/descriptor";
import { XLElementDescriptor } from "./creatures/xl-element/descriptor";
import { XXLElementDescriptor } from "./creatures/xxl-element/descriptor";
import { getMaterial } from "./getMaterial";
import { getVertexData } from "./getVertexData";

export const City: Biome = {
  name: "city",
  id: 1,
  getVertexData: getVertexData,
  getMaterial: getMaterial,
  blendWidth: 3,
  joinable: true,
  blendable: false,
  spawnables: [
    BeebleDescriptor,
    ApartmentDescriptor,
    BigBeebleDescriptor,
    XLElementDescriptor,
    XXLElementDescriptor,
    Building1Descriptor,
  ],
};
