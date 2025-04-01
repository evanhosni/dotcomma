import { Block } from "../../../../../world/types";
import { Beeple } from "../creatures/beeple/Beeple";
import { Apartment } from "./apartment/Apartment";

export const blocks: Block[] = [
  {
    name: "apartments",
    joinable: true,
    components: [Apartment, Beeple],
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
