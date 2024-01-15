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

export const ArcticProperties = {
  getHeight: (vertexData: VertexData) => {
    const { x, y } = vertexData;
    return _noise.terrain(noise, x, y);
  },

  fragShader: `  
        void main() {  
          gl_FragColor = vec4(0.4, 0.4, 0.9, 1.0);
        }
      `,
};
