import { SPAWN_SIZE } from "../world/types";

export interface GameObjectProps {
  component: React.FC<any>;
  id: string;
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  render_distance: number;
  spawn_size: SPAWN_SIZE;
  onDestroy: (id: string) => void;
}
