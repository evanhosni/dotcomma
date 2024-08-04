import { useConvexPolyhedron } from "@react-three/cannon";
import * as THREE from "three";

export const createConvexCollider = (mesh: THREE.Mesh) => {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position.array;
  const index = geometry.index ? geometry.index.array : null;
  const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(mesh.rotation);
  const scaleMatrix = new THREE.Matrix4().makeScale(mesh.scale.x, mesh.scale.y, mesh.scale.z);

  const vertices: THREE.Vector3[] = [];
  for (let i = 0; i < position.length; i += 3) {
    const vertex = new THREE.Vector3(position[i], position[i + 1], position[i + 2]);
    vertex.applyMatrix4(scaleMatrix);
    vertex.applyMatrix4(rotationMatrix);
    vertices.push(vertex);
  }

  const faces: THREE.Vector3Tuple[] = [];
  if (index) {
    for (let i = 0; i < index.length; i += 3) {
      faces.push([index[i], index[i + 1], index[i + 2]]);
    }
  } else {
    for (let i = 0; i < vertices.length; i += 3) {
      faces.push([i, i + 1, i + 2]);
    }
  }

  // const orderedFaces: THREE.Vector3Tuple[] = []; //NOTE this silences errors but fucks up actual collider orientation
  // for (const face of faces) {
  //   const normal = new THREE.Vector3();
  //   const edge1 = vertices[face[1]].clone().sub(vertices[face[0]]);
  //   const edge2 = vertices[face[2]].clone().sub(vertices[face[1]]);
  //   normal.crossVectors(edge1, edge2).normalize();
  //   if (normal.dot(vertices[face[0]]) < 0) {
  //     orderedFaces.push([face[0], face[2], face[1]]);
  //   } else {
  //     orderedFaces.push(face);
  //   }
  // }

  return {
    vertices,
    faces,
    position: mesh.position.clone(),
    rotation: mesh.rotation.clone(),
  };
};

export const ConvexCollider = ({
  vertices,
  faces,
  position,
  offset,
  rotation,
}: {
  vertices: THREE.Vector3Tuple[];
  faces: THREE.Vector3Tuple[];
  position: THREE.Vector3;
  offset: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}) => {
  const [ref] = useConvexPolyhedron(() => ({
    args: [vertices, faces],
    position: [position.x + offset[0], position.y + offset[1], position.z + offset[2]],
    rotation: rotation,
  }));

  return <mesh ref={ref as any} />;
};
