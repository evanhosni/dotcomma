export interface GameObjectProps {
  component: React.FC<any>;
  id: string;
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  renderDistance: number;
  frustumPadding?: number;
  onDestroy: (id: string) => void;
}
