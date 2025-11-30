import { _material } from "../../utils/material/_material";
import { MaterialData } from "../../world/types";
import fragmentShader from "./shaders/fragment.glsl";

export const getMaterial = async (): Promise<MaterialData> => {
  const [roadTexture, sandTexture] = await _material.loadTextures(["road.jpg", "potato_sack.jpg"]);

  return {
    uniforms: {
      roadtexture: { value: roadTexture },
      sandtexture: { value: sandTexture },
    },
    fragmentShader,
  };
};
