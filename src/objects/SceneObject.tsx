import { Debug, useConvexPolyhedron } from "@react-three/cannon";
import { useLoader } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { Mesh } from "three";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

const createConvexPolyhedron = (geometry: THREE.BufferGeometry, scale: THREE.Vector3, rotation: THREE.Euler) => {
  const position = geometry.attributes.position.array;
  const index = geometry.index ? geometry.index.array : null;

  const vertices: THREE.Vector3[] = [];
  const faces: THREE.Vector3Tuple[] = [];

  const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(rotation);
  const scaleMatrix = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);

  // Collect vertices
  for (let i = 0; i < position.length; i += 3) {
    const vertex = new THREE.Vector3(position[i], position[i + 1], position[i + 2]);
    vertex.applyMatrix4(scaleMatrix); // Apply scaling
    vertex.applyMatrix4(rotationMatrix); // Apply rotation
    vertices.push(vertex);
  }

  // Collect faces
  if (index) {
    for (let i = 0; i < index.length; i += 3) {
      faces.push([index[i], index[i + 1], index[i + 2]]);
    }
  } else {
    for (let i = 0; i < vertices.length; i += 3) {
      faces.push([i, i + 1, i + 2]);
    }
  }

  // Ensure correct winding order for faces
  const orderedFaces: THREE.Vector3Tuple[] = [];
  for (const face of faces) {
    const normal = new THREE.Vector3();
    const edge1 = vertices[face[1]].clone().sub(vertices[face[0]]);
    const edge2 = vertices[face[2]].clone().sub(vertices[face[1]]);
    normal.crossVectors(edge1, edge2).normalize();
    if (normal.dot(vertices[face[0]]) < 0) {
      // Reverse the face order if the normal points inward
      orderedFaces.push([face[0], face[2], face[1]]);
    } else {
      orderedFaces.push(face);
    }
  }

  return {
    vertices,
    faces: orderedFaces,
  };
};

const useGLTFColliders = (gltf: GLTF) => {
  const colliders = useMemo(() => {
    const colliders: any[] = [];
    gltf.scene.traverse((child) => {
      if (child instanceof Mesh && child.geometry) {
        const { vertices, faces } = createConvexPolyhedron(child.geometry, child.scale, child.rotation);

        colliders.push({
          vertices,
          faces,
          position: child.position.clone(),
          rotation: child.rotation.clone(),
        });
      }
    });
    return colliders;
  }, [gltf]);

  return colliders;
};

const ConvexCollider = ({
  vertices,
  faces,
  position,
  rotation,
  offset,
}: {
  vertices: any;
  faces: any;
  position: any;
  rotation: any;
  offset: any;
}) => {
  const [ref] = useConvexPolyhedron(() => ({
    args: [vertices, faces],
    position: [position.x + offset[0], position.y + offset[1], position.z + offset[2]],
    rotation: rotation,
  }));

  return <mesh ref={ref as any} />;
};

export const SceneObject = ({
  model,
  coordinates,
  scale = [1, 1, 1],
  rotation = [0, 0, 0],
}: {
  model: string;
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
}) => {
  const gltf = useLoader(GLTFLoader, model);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);

  const colliders = useGLTFColliders(gltf);

  return (
    <Debug>
      <Suspense fallback={null}>
        {colliders.map((collider, index) => (
          <ConvexCollider key={index} {...collider} offset={coordinates} rotation={rotation} />
        ))}
        <primitive
          object={scene}
          position={[coordinates[0], coordinates[1], coordinates[2]]}
          scale={scale as THREE.Vector3Tuple}
          rotation={new THREE.Euler(...rotation)}
        />
      </Suspense>
    </Debug>
  );
};
