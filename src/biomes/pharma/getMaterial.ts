import { _material } from "../../utils/material/_material";
import { MaterialData } from "../../world/types";
import fragmentShader from "./shaders/fragment.glsl";

export const getMaterial = async (): Promise<MaterialData> => {
  const [bluemudTexture] = await _material.loadTextures(["blue_mud.jpg"]);

  return {
    uniforms: {
      bluemudtexture: { value: bluemudTexture },
    },
    fragmentShader,
  };
};
