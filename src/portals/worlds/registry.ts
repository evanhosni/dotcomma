import { IndoorWorldProps } from "../types";
import { IndoorWorld } from "./IndoorWorld";

export interface IndoorWorldEntry {
  id: string;
  urlPath: string;
  component: React.FC<IndoorWorldProps>;
}

export const INDOOR_WORLDS: IndoorWorldEntry[] = [
  {
    id: "indoor-world",
    urlPath: "/indoor-world",
    component: IndoorWorld,
  },
];

export const getIndoorWorldById = (id: string): IndoorWorldEntry | undefined =>
  INDOOR_WORLDS.find((w) => w.id === id);

export const getIndoorWorldByPath = (path: string): IndoorWorldEntry | undefined =>
  INDOOR_WORLDS.find((w) => w.urlPath === path);
