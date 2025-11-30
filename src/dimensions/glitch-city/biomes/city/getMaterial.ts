import { _material } from "../../../../utils/material/_material";
import { MaterialData } from "../../../../world/types";
import fragmentShader from "./shaders/fragment.glsl";

export const getMaterial = async (): Promise<MaterialData> => {
  const [roadTexture, sidewalkTexture] = await _material.loadTextures(["road.jpg", "road.png"]);

  return {
    uniforms: {
      roadtexture: { value: roadTexture },
      sidewalktexture: { value: sidewalkTexture },
    },
    fragmentShader,
  };
};
