import { Debug } from "@react-three/cannon";
import { useLoader } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { CapsuleCollider } from "./colliders/capsuleCollider";
import { ConvexCollider } from "./colliders/convexCollider";
import { SphereCollider } from "./colliders/sphereCollider";
import { TrimeshCollider } from "./colliders/trimeshCollider";

const createColliders = /*async*/ (gltf: GLTF) /*: Promise<any>*/ => {
  // return new Promise((resolve) => {
  const capsuleColliders: any[] = [];
  const sphereColliders: any[] = [];
  const convexColliders: any[] = [];
  const trimeshColliders: any[] = [];

  gltf.scene.traverse((child) => {
    // if (child instanceof Mesh && child.geometry) {
    //   // if (!child.userData.collision) return;
    //   if (child.userData.capsule) {
    //     capsuleColliders.push(createCapsuleCollider(child));
    //     return;
    //   }
    //   if (child.userData.sphere) {
    //     sphereColliders.push(createSphereCollider(child));
    //     return;
    //   }
    //   if (child.userData.convex) {
    //     convexColliders.push(createConvexCollider(child));
    //     return;
    //   }
    //   trimeshColliders.push(createTrimeshCollider(child));
    // }
  });
  return { capsuleColliders, sphereColliders, convexColliders, trimeshColliders };
  // resolve({ sphereColliders, convexColliders });
  // });
};

export const SceneObject = ({
  model,
  coordinates,
  scale = [1, 2, 2],
  rotation = [0, Math.PI / 2, 0],
}: {
  model: string;
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
}) => {
  const gltf = useLoader(GLTFLoader, model);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);

  // const [convexColliders, setConvexColliders] = useState<any[]>([]);
  // const [sphereColliders, setSphereColliders] = useState<any[]>([]);

  const { capsuleColliders, sphereColliders, convexColliders, trimeshColliders } = useMemo(
    () => createColliders(gltf),
    [gltf]
  );

  // useEffect(() => {
  //   const fetchColliders = async () => {
  //     const { sphereColliders, convexColliders } = await createColliders(gltf);
  //     setSphereColliders(sphereColliders);
  //     setConvexColliders(convexColliders);
  //   };

  //   fetchColliders();
  // }, [gltf]);

  const groupTransform = new THREE.Matrix4().compose(
    new THREE.Vector3(...coordinates),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale)
  );

  const applyTransform = (collider: any) => {
    const position = new THREE.Vector3().copy(collider.position).applyMatrix4(groupTransform);
    const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromRotationMatrix(groupTransform));
    return {
      ...collider,
      position,
      rotation,
    };
  };

  return (
    <Debug>
      <Suspense fallback={null}>
        <primitive
          object={scene}
          position={[coordinates[0], coordinates[1], coordinates[2]]}
          scale={scale as THREE.Vector3Tuple}
          rotation={new THREE.Euler(...rotation)}
        />
        {capsuleColliders.map((collider, index) => (
          <CapsuleCollider key={index} {...applyTransform(collider)} rotation={rotation} />
        ))}
        {sphereColliders.map((collider, index) => (
          <SphereCollider key={index} {...applyTransform(collider)} rotation={rotation} />
        ))}
        {convexColliders.map((collider, index) => (
          <ConvexCollider key={index} {...applyTransform(collider)} rotation={rotation} />
        ))}
        {trimeshColliders.map((collider, index) => (
          <TrimeshCollider key={index} {...applyTransform(collider)} rotation={rotation} />
        ))}
      </Suspense>
    </Debug>
  );
};
