import { TerrainNoiseParams, _noise } from "../../_/_noise";
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

export const StaticProperties = {
  getHeight: (vertexData: VertexData) => {
    const { x, y } = vertexData;
    return _noise.terrain(noise, x, y);
  },

  fragShader: `  
        void main() {  
          gl_FragColor = vec4(0.3, 0.3, 0.3, 1.0);
        }
      `,
};
