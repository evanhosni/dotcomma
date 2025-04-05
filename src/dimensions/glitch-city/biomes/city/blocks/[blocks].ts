import { Block } from "../../../../../world/types";
import { Apartment } from "./apartment/Apartment";

export const blocks: Block[] = [
  {
    name: "apartments",
    joinable: true,
    components: [Apartment],
  },
  {
    name: "theater",
    joinable: false,
    components: [],
  },
  {
    name: "park",
    joinable: true,
    components: [],
  },
  {
    name: "grocery store",
    joinable: false,
    components: [],
  },
];
