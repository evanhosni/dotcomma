import Noise from "noise-ts";
import { _math } from "../math/_math";

export interface TerrainNoiseParams {
  type: "simplex" | "perlin";
  octaves: number;
  persistence: number;
  lacunarity: number;
  exponentiation: number;
  height: number;
  scale: number;
}

export namespace _noise {
  var noise = new Noise(_math.seedRand("bierce"));

  export const simplex = (x: number, y: number) => {
    return noise.simplex2(x, y);
  };

  export const perlin = (x: number, y: number) => {
    return noise.perlin2(x, y);
  };

  export const terrain = (params: TerrainNoiseParams, x: number, y: number) => {
    const xs = x / params.scale;
    const ys = y / params.scale;
    const G = 2.0 ** -params.persistence;
    let amplitude = 1.0;
    let frequency = 1.0;
    let normalization = 0;
    let total = 0;
    for (let o = 0; o < params.octaves; o++) {
      const noiseValue =
        params.type === "simplex"
          ? _noise.simplex(xs * frequency, ys * frequency) * 0.5 + 0.5
          : _noise.perlin(xs * frequency, ys * frequency) * 0.5 + 0.5;
      total += noiseValue * amplitude;
      normalization += amplitude;
      amplitude *= G;
      frequency *= params.lacunarity;
    }
    total /= normalization;
    total -= 0.5;

    return Math.pow(total, params.exponentiation) * params.height;
  };
}
