import { noise } from "../engine/noise/noise.js";

export const pharmaforest = (function () {
    class PharmaForest {
        constructor() {
            this.noise = new noise.Noise({
                octaves: 6,
                persistence: 0.707,
                lacunarity: 1.8,
                exponentiation: 4.5,
                height: 6000.0,
                scale: 1100.0,
                noiseType: "simplex",
                seed: 1,
            });
        }

        GetHeight(x, y) {
            return 500;
            return this.noise.Get(x, y);
        }
    }

    return {
        PharmaForest: PharmaForest,
    };
})();
