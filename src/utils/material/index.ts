import * as THREE from "three";
import { MaterialData } from "../../world/types";

/** The file each loaded texture came from — what tells two same-named uniforms apart. */
const TEXTURE_FILES = new WeakMap<THREE.Texture, string>();

/** The filename `loadTextures` loaded this texture from (undefined for any other texture). */
export const textureFileOf = (texture: THREE.Texture): string | undefined => TEXTURE_FILES.get(texture);

export namespace _material {
  export const loadTextures = async (filenames: string[]): Promise<THREE.Texture[]> => {
    const textureLoader = new THREE.TextureLoader();
    return Promise.all(
      filenames.map(
        (filename) =>
          new Promise<THREE.Texture>((resolve, reject) =>
            textureLoader.load(
              process.env.PUBLIC_URL + "/textures/" + filename,
              (tex) => {
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                TEXTURE_FILES.set(tex, filename);
                resolve(tex);
              },
              undefined,
              reject,
            ),
          ),
      ),
    );
  };

  /** A biome/region material from its fragment shader and its sampler uniforms (uniform name →
   *  filename under public/textures/, in declaration order). */
  export const fromShader =
    (fragmentShader: string, textures: Readonly<Record<string, string>> = {}) =>
    async (): Promise<MaterialData> => {
      const names = Object.keys(textures);
      const loaded = await loadTextures(names.map((n) => textures[n]));
      return { uniforms: Object.fromEntries(names.map((n, i) => [n, { value: loaded[i] }])), fragmentShader };
    };
}
