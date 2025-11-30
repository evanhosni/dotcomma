import { _material } from "../../../../utils/material/_material";
import { MaterialData } from "../../../../world/types";
import fragmentShader from "./shaders/fragment.glsl";

export const getMaterial = async (): Promise<MaterialData> => {
  const [roadTexture, grassTexture] = await _material.loadTextures(["road.jpg", "moss.png"]);

  return {
    uniforms: {
      roadtexture: { value: roadTexture },
      grasstexture: { value: grassTexture },
    },
    fragmentShader,
  };
};
