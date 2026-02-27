export interface SpawnDescriptor {
  id: string; // unique key, e.g. "beeble"
  component: React.FC<SpawnedObjectProps>;
  model?: string; // GLTF path for preloading
  footprint: number; // radius in world units for spacing
  density: number; // instances per 1,000,000 sq units
  clustering: number; // 0 = uniform, 1 = heavily clustered
  renderDistance: number; // max camera distance
  colliderDistance?: number; // defaults to renderDistance / 3
  frustumPadding?: number; // defaults to 3
  priority?: number; // 0 = rarest (placed first), 100 = common. Default 50
  biomeIds?: number[]; // restrict to specific biomes
  heightRange?: [number, number]; // restrict to height band
  slopeRange?: [number, number]; // restrict to slope range (degrees)
  spacingOverrides?: Record<string, number>; // custom min distance vs other descriptor ids
}

export interface SpawnedObjectProps {
  id: string;
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  renderDistance: number;
  frustumPadding: number;
  onDestroy: (id: string) => void;
}

export interface SpawnPoint {
  x: number;
  z: number;
  height: number;
  biomeId: number;
  descriptorId: string;
}
