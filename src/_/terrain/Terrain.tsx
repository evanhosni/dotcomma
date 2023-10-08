import { useFrame, useThree } from "@react-three/fiber";
import { TerrainChunkManager } from "../terrain";

export const Terrain = () => {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  const terr = new TerrainChunkManager({
    scene: scene,
    camera: camera,
  });

  useFrame((state, delta) => {
    terr.Update();
  });

  return <></>;
};
