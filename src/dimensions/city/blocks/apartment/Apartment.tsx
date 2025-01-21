import { SceneObject } from "../../../../objects/SceneObject";

export const Apartment = ({
  coordinates,
  scale,
  rotation,
}: {
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
}) => {
  return <SceneObject model="/models/apartment.glb" coordinates={coordinates} scale={scale} rotation={rotation} />;
};
