// The body is created and destroyed IMPERATIVELY, never via React state: a
// setState from the frame loop defeats ActorPool's element-identity bailout
// (a 1–5 fps loss). The hull count itself is not a measured cost (CLAUDE.md →
// Procedural buildings, point 4).

export interface ProxyColliderHandle {
  dispose: () => void;
}

export interface ProxyDeps {
  world: {
    createRigidBody: (desc: any) => any;
    createCollider: (desc: any, body: any) => any;
    removeRigidBody: (body: any) => void;
  };
  rapier: {
    RigidBodyDesc: { fixed: () => any };
    ColliderDesc: { convexHull: (points: Float32Array) => any };
  };
}
