import { _material } from "../../utils/material/_material";
import { MaterialData } from "../../world/types";
import fragmentShader from "./shaders/fragment.glsl";

export const getMaterial = async (): Promise<MaterialData> => {
  const [roadTexture, bluemudTexture] = await _material.loadTextures(["road.jpg", "blue_mud.jpg"]);

  return {
    uniforms: {
      roadtexture: { value: roadTexture },
      bluemudtexture: { value: bluemudTexture },
    },
    fragmentShader,
  };
};
