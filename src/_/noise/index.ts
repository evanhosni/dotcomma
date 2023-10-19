import Noise from "noise-ts";
import { _math } from "../math";

export namespace _noise {
  var noise = new Noise(_math.seed_rand("bierce"));

  export const simplex = (x: number, y: number) => {
    return noise.simplex2(x, y);
  };

  export const perlin = (x: number, y: number) => {
    return noise.perlin2(x, y);
  };
}