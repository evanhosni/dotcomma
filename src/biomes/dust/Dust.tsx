import { TerrainNoiseParams, _noise } from "../../_/noise";
import { VertexData } from "../../types/VertexData";

const noise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 2,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 20,
  scale: 50,
};

export const DustProperties = {
  getHeight: (vertexData: VertexData) => {
    const { x, y } = vertexData;
    return _noise.terrain(noise, x, y);
  },

  fragShader: `  
        void main() {  
          gl_FragColor = vec4(0.6, 0.2, 0.0, 1.0);
        }
      `,
};
