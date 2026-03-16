import { _material } from "../../utils/material/_material";
import { MaterialData } from "../../world/types";
import fragmentShader from "./shaders/fragment.glsl";

export const getMaterial = async (): Promise<MaterialData> => {
  const [grassTexture] = await _material.loadTextures(["moss.png"]);

  return {
    uniforms: {
      grasstexture: { value: grassTexture },
    },
    fragmentShader,
  };
};
