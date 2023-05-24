import {noise} from '../engine/noise/noise.js';

export const dustworld = (function() {

    class Dustworld {
        constructor() {
            this.noise = new noise.Noise({
                octaves: 6,
                persistence: 0.707,
                lacunarity: 1.8,
                exponentiation: 4.5,
                height: 800.0,
                scale: 500.0,
                noiseType: 'simplex',
                seed: 1
            })
        }

        GetHeight(x,y) {
            return 1000
            return this.noise.Get(x,y)
        }
    }
  
    return {
      Dustworld: Dustworld
    }
  })();