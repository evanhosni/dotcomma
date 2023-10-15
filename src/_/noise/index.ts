import { RandomFn, createNoise2D } from "simplex-noise";
import { _math } from "../math";

export namespace _noise {
  const blarnky = _math.seed_rand("bierce");
  const prng: RandomFn = () => {
    return blarnky;
  };

  export const simplex = (x: number, y: number) => {
    const noise2d = createNoise2D(prng);
    return noise2d(x, y);
  };
}
