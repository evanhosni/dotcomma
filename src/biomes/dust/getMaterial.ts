import { _material } from "../../utils/material/_material";
import { MaterialData } from "../../world/types";
import fragmentShader from "./shaders/fragment.glsl";

export const getMaterial = async (): Promise<MaterialData> => {
  const [sandTexture] = await _material.loadTextures(["potato_sack.jpg"]);

  return {
    uniforms: {
      sandtexture: { value: sandTexture },
    },
    fragmentShader,
  };
};
