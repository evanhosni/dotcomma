export interface SpawnDescriptor {
  id: string; // unique key, e.g. "beeble"
  component: React.FC<SpawnedObjectProps>;
  model?: string; // GLTF path for preloading
  scale?: THREE.Vector3Tuple; // render scale, defaults to [1,1,1]
  footprint: number; // radius in world units for spacing
  density: number; // instances per 1,000,000 sq units
  clustering: number; // 0 = uniform, 1 = heavily clustered
  renderDistance: number; // spawn radius: camera distance at which the object mounts (and starts fading)
  despawnDistance?: number; // hard unmount distance. Default: (renderDistance + footprint/2) * 1.2
  immediateRadius?: number; // inner radius where despawned objects can't REspawn. Default: spawn radius * 0.5
  colliderDistance?: number; // defaults to renderDistance / 3
  frustumPadding?: number; // defaults to 3
  priority?: number; // 0 = rarest (placed first), 100 = common. Default 50
  biomeIds?: number[]; // restrict to specific biomes
  heightRange?: [number, number]; // restrict to height band
  slopeRange?: [number, number]; // restrict to slope range (degrees)
  roadDistanceRange?: [number, number]; // restrict by distance to the road centerline (city: keep buildings off roads / lamps on sidewalks)
  spacingOverrides?: Record<string, number>; // custom min distance vs other descriptor ids
  cursorOverride?: boolean; // true = always grow cursor on hover, false = never, undefined = auto-detect from triggers
  quantization?: number; // vertex quantization grid size for this object; defaults to the global grid
}

export interface SpawnedObjectProps {
  id: string;
  model?: string;
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  renderDistance: number;
  despawnDistance?: number; // self-despawn (hard kill) distance; components fall back to a renderDistance buffer
  frustumPadding: number;
  onDestroy: (id: string) => void;
  cursorOverride?: boolean;
  quantization?: number;
}

export interface SpawnPoint {
  x: number;
  z: number;
  height: number;
  biomeId: number;
  descriptorId: string;
}
