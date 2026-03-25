import { _material } from "../../utils/material/_material";
import { MaterialData } from "../../world/types";
import fragmentShader from "./shaders/fragment.glsl";

export const getMaterial = async (): Promise<MaterialData> => {
  const [grassTexture, grassDirtTexture, dirtTexture] = await _material.loadTextures([
    "grass.png",
    "grass-dirt.png",
    "dirt.png",
  ]);

  return {
    uniforms: {
      grasstexture: { value: grassTexture },
      grassdirttexture: { value: grassDirtTexture },
      dirttexture: { value: dirtTexture },
    },
    fragmentShader,
  };
};
