import { RandomFn, createNoise2D } from 'simplex-noise';
import { _math } from '../math';

export namespace _noise {

    const blarnky = _math.seed_rand('bierce')
    const prng: RandomFn = () => {
        return blarnky
    }

    export const simplex = (x: number, y: number) => {
        const noise2d = createNoise2D(prng)
        return noise2d(x, y)
    }


//   class _NoiseGenerator {
//     private _params: {
//       seed: number;
//       scale: number;
//       persistence: number;
//       lacunarity: number;
//       exponentiation: number;
//       height: number;
//       octaves: number;
//       noiseType: string;
//     };
//     private _noise: {
//       simplex: SimplexNoise;
//     };

//     constructor(params: {
//       seed: number;
//       scale: number;
//       persistence: number;
//       lacunarity: number;
//       exponentiation: number;
//       height: number;
//       octaves: number;
//       noiseType: string;
//     }) {
//       this._params = params;
//       this._Init();
//     }

//     private _Init() {
//       this._noise = {
//         simplex: new SimplexNoise(this._params.seed),
//       };
//     }

//     public Get(x: number, y: number): number {
//       const xs = x / this._params.scale;
//       const ys = y / this._params.scale;
//       const noiseFunc = this._noise[this._params.noiseType];
//       const G = 2.0 ** -this._params.persistence;
//       let amplitude = 1.0;
//       let frequency = 1.0;
//       let normalization = 0;
//       let total = 0;
//       for (let o = 0; o < this._params.octaves; o++) {
//         const noiseValue =
//           noiseFunc.noise2D(xs * frequency, ys * frequency) * 0.5 + 0.5;
//         total += noiseValue * amplitude;
//         normalization += amplitude;
//         amplitude *= G;
//         frequency *= this._params.lacunarity;
//       }
//       total /= normalization;
//       return Math.pow(total, this._params.exponentiation) * this._params.height;
//     }
//   }

//   export const Noise = _NoiseGenerator;
}
