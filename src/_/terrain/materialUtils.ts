import * as THREE from "three";

export const loadTextures = async (
  filenames: string[]
): Promise<THREE.Texture[]> => {
  const textureLoader = new THREE.TextureLoader();
  return Promise.all(
    filenames.map(
      (filename) =>
        new Promise<THREE.Texture>((resolve, reject) =>
          textureLoader.load(
            process.env.PUBLIC_URL + "/textures/" + filename,
            resolve,
            undefined,
            reject
          )
        )
    )
  );
};
