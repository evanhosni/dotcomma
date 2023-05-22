import {noise} from '../engine/noise/noise.js';

export const glitchcity = (function() {

    class GlitchCity {
        constructor() {
            this.noise = new noise.Noise({
                octaves: 2,
                persistence: 0.707,
                lacunarity: 1.8,
                exponentiation: 2,
                height: 200.0,
                scale: 3000.0,
                noiseType: 'simplex',
                seed: 1
            })
        }

        GetHeight(x,y) {
            return this.noise.Get(x,y)
        }
    }
  
    return {
      GlitchCity: GlitchCity
    }
  })();