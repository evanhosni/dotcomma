/**
 * The server BUNDLES the client's content tree to read it as data (src/content/), so its typecheck
 * follows the client's view files too. These are the subpath modules whose types the client's own
 * TypeScript resolves and the server's (a newer version, `moduleResolution: Bundler`) does not —
 * none of them is ever CALLED here (the tree is walked, never rendered), so `any` is exact enough.
 * The client's `tsc --noEmit` is what actually checks these files.
 */
declare module "three/examples/jsm/utils/BufferGeometryUtils" {
  export const mergeGeometries: any;
  export const mergeVertices: any;
  export const toCreasedNormals: any;
}
declare module "three/examples/jsm/loaders/GLTFLoader" {
  export type GLTF = any;
  export const GLTFLoader: any;
}
declare module "@react-three/drei/core/Gltf" {
  export const useGLTF: any;
}
