import { _material } from "../../utils/material/_material";
import { MaterialData } from "../../world/types";
import fragmentShader from "./shaders/fragment.glsl";

export const getMaterial = async (): Promise<MaterialData> => {
  const [sidewalkTexture, roadTexture] = await _material.loadTextures(["road.png", "road.jpg"]);

  return {
    uniforms: {
      sidewalktexture: { value: sidewalkTexture },
      roadtexture: { value: roadTexture },
    },
    fragmentShader,
  };
};
