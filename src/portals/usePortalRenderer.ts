import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { hideFrustumObjects, restoreFrustumVisibility } from "../objects/frustumVisibility";
import {
  FULL_RATE_DIST,
  MAX_RES_SCALE,
  MIN_RES_SCALE,
  PORTAL_FADE_RANGE,
  RES_SCALE_STEP,
  THROTTLE_FRAMES,
} from "./constants";
import { applyObliqueNearClip, getNearPlaneCornerDistance, getPortalPairMatrix } from "./portalMath";
import { PortalDescriptor, usePortalContext } from "./PortalContext";
import { acquireRenderTarget, releaseRenderTarget } from "./portalRenderTargetPool";

// --- Projective-texture shaders (same technique as Three.js Reflector) ---
// Every vertex samples the render target at its own screen position, so the
// image is identical whether the surface is the door mesh or the extruded
// near-plane-protection box — only screen coverage differs.
const VERT = `
uniform mat4 textureMatrix;
varying vec4 vPortalUv;
void main() {
  vPortalUv = textureMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
uniform sampler2D portalTexture;
uniform float portalOpacity;
varying vec4 vPortalUv;
void main() {
  vec4 col = texture2DProj(portalTexture, vPortalUv);
  gl_FragColor = vec4(col.rgb * portalOpacity, 1.0);
}
`;

// --- Pre-allocated scratch objects ---
const _localView = new THREE.Vector3();
const _viewPos = new THREE.Vector3();
const _viewMat = new THREE.Matrix4();
const _viewMatInv = new THREE.Matrix4();
const _virtualMat = new THREE.Matrix4();

// Projective texture matrix: bias * proj * view * model -> maps mesh verts to render-target UVs
const _biasMatrix = new THREE.Matrix4().set(
  0.5, 0.0, 0.0, 0.5,
  0.0, 0.5, 0.0, 0.5,
  0.0, 0.0, 0.5, 0.5,
  0.0, 0.0, 0.0, 1.0,
);

// Frustum culling
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _boundSphere = new THREE.Sphere();

const _drawSize = new THREE.Vector2();
const _savedClearColor = new THREE.Color();

const isSphereVisible = (
  projection: THREE.Matrix4,
  viewInverse: THREE.Matrix4,
  center: THREE.Vector3,
  radius: number,
): boolean => {
  _projScreenMatrix.multiplyMatrices(projection, viewInverse);
  _frustum.setFromProjectionMatrix(_projScreenMatrix);
  _boundSphere.set(center, radius);
  return _frustum.intersectsSphere(_boundSphere);
};

/** Hide portal surfaces that would sample their texture from the wrong camera
 *  during `rendering`'s render pass. A portal's projective texture is only
 *  valid for the observer its texture matrix was built with. Kept visible:
 *  exit portals whose context IS the enter portal being rendered (the
 *  recursion case), and fully faded portals (solid black is valid from any
 *  observer). */
const hideForeignPortalMeshes = (portals: Map<string, PortalDescriptor>, rendering: PortalDescriptor): void => {
  for (const d of portals.values()) {
    if (d.id === rendering.id || !d.activeMesh) continue;
    d.prevVisible = d.activeMesh.visible;
    const keep =
      (rendering.direction === "enter" && d.direction === "exit" && d.contextEnterId === rendering.id) ||
      (d.activeMesh.material as THREE.ShaderMaterial).uniforms.portalOpacity.value < 0.01;
    if (!keep) d.activeMesh.visible = false;
  }
};

const restoreForeignPortalMeshes = (portals: Map<string, PortalDescriptor>, rendering: PortalDescriptor): void => {
  for (const d of portals.values()) {
    if (d.id === rendering.id || !d.activeMesh) continue;
    if (d.prevVisible !== undefined) {
      d.activeMesh.visible = d.prevVisible;
      d.prevVisible = undefined;
    }
  }
};

interface UsePortalRendererProps {
  id: string;
  pairedId: string;
  size: [number, number];
  activationDistance: number;
  direction: "enter" | "exit";
}

export const usePortalRenderer = ({ id, pairedId, size, activationDistance, direction }: UsePortalRendererProps) => {
  const { getPortal, portals } = usePortalContext();
  const { gl, scene, camera } = useThree();

  const doorMeshRef = useRef<THREE.Mesh>(null);
  const boxMeshRef = useRef<THREE.Mesh>(null);
  const frameCounter = useRef(0);
  const hasRendered = useRef(false);
  const protecting = useRef(false);
  const [width, height] = size;

  // Persistent virtual camera
  const virtualCamera = useMemo(() => {
    const cam = new THREE.PerspectiveCamera();
    cam.matrixAutoUpdate = false;
    return cam;
  }, []);

  // Render target from pool (avoids GPU allocation on spawn/despawn)
  const renderTarget = useMemo(() => acquireRenderTarget(), []);

  // Shared uniforms — one set drives both materials
  const uniforms = useMemo(
    () => ({
      textureMatrix: { value: new THREE.Matrix4() },
      portalTexture: { value: renderTarget.texture },
      portalOpacity: { value: 0 },
    }),
    [renderTarget],
  );

  // Portal shader materials — toneMapped:false because the render target
  // already contains fully processed (tone-mapped + sRGB) values. The door
  // renders front faces only (its back sits inside the wall shell and must
  // not show); the protection box must be DoubleSide because the camera
  // passes through its interior while crossing.
  const doorMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        toneMapped: false,
        side: THREE.FrontSide,
      }),
    [uniforms],
  );
  const boxMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [uniforms],
  );

  // Return render target to pool on unmount; dispose per-instance materials
  useEffect(
    () => () => {
      releaseRenderTarget(renderTarget);
      doorMaterial.dispose();
      boxMaterial.dispose();
    },
    [renderTarget, doorMaterial, boxMaterial],
  );

  // ---- Virtual-camera rendering ----
  // Exit portals render at 0.9, enter portals at 1: an enter portal's preview
  // (interior) may contain exit portal surfaces, so their textures must be
  // fresh before the enter portal renders. Both run after the teleport system
  // (-2) and before the explicit scene render (2).
  useFrame(() => {
    const door = doorMeshRef.current;
    const box = boxMeshRef.current;
    const self = getPortal(id);
    if (!door || !box || !self) return;
    const mainCam = camera as THREE.PerspectiveCamera;

    // Beyond the fade range the portal stays visible as a solid black door
    // (opacity 0 multiplies the texture to black) instead of a see-through
    // hole into the building shell.
    const showBlack = () => {
      uniforms.portalOpacity.value = 0;
      protecting.current = false;
      door.visible = true;
      box.visible = false;
      self.activeMesh = door;
    };

    // ---- Choose the observer ----
    // Normally the main camera. For an exit portal whose building the player
    // is approaching from outside, the observer is the nearest enter portal's
    // virtual camera (context mode) — the exact camera that renders the
    // interior preview this surface will appear in. At the teleport instant
    // the context camera IS the post-teleport main camera, so the handoff
    // between modes is pixel-continuous.
    camera.updateMatrixWorld();
    _localView.copy(camera.position).applyMatrix4(self.invMatrix);
    let viewDist = _localView.length();
    let usingContext = false;
    if (viewDist < activationDistance) {
      _viewMat.copy(camera.matrixWorld);
      _viewMatInv.copy(camera.matrixWorldInverse);
    } else if (direction === "exit" && self.contextEnterId) {
      const ctxEnter = getPortal(self.contextEnterId);
      const ctxEnterPaired = ctxEnter && getPortal(ctxEnter.pairedId);
      if (!ctxEnter || !ctxEnterPaired) {
        showBlack();
        return;
      }
      // The context enter portal is off-screen → its preview isn't being
      // watched, so skip this whole update (meshes keep last state).
      const ctxRadius = Math.max(ctxEnter.halfWidth, ctxEnter.halfHeight) * 1.4;
      if (!isSphereVisible(mainCam.projectionMatrix, camera.matrixWorldInverse, ctxEnter.position, ctxRadius)) {
        return;
      }
      getPortalPairMatrix(ctxEnter.invMatrix, ctxEnterPaired.matrix, _viewMat).multiply(camera.matrixWorld);
      _viewMatInv.copy(_viewMat).invert();
      _viewPos.setFromMatrixPosition(_viewMat);
      _localView.copy(_viewPos).applyMatrix4(self.invMatrix);
      viewDist = _localView.length();
      usingContext = true;
    } else {
      showBlack();
      return;
    }
    // Portal-local observer position: x/y span the door, z is the signed
    // distance to the plane.
    const viewSignedDist = _localView.z;

    // Distance-based fade (relative to the observer). Until the first render
    // target fill, force black — sampling a pooled target could show another
    // portal's stale image.
    const opacity = Math.max(0, Math.min(1, (activationDistance - viewDist) / PORTAL_FADE_RANGE));
    uniforms.portalOpacity.value = hasRendered.current ? opacity : 0;
    if (opacity < 0.01) {
      showBlack();
      return;
    }

    // ---- Near-plane protection (main-camera mode only — a context observer
    // never physically crosses the plane) ----
    // Normally the portal surface is the door-shaped mesh, flush with the
    // wall. Only while the camera is close enough that its near plane could
    // clip through the door plane do we swap to a box extruded through the
    // plane — at that range the doorway fills the screen, and because the
    // texture is sampled in screen space both surfaces render identical
    // pixels. This keeps the door silhouette exact at all other times.
    const thickness = getNearPlaneCornerDistance(mainCam) * 1.1;
    if (usingContext) {
      protecting.current = false;
    } else {
      const nearDoor =
        Math.abs(_localView.x) < self.halfWidth + thickness &&
        Math.abs(_localView.y) < self.halfHeight + thickness;
      // Hysteresis so the swap doesn't oscillate when hovering at the boundary
      const releaseDist = protecting.current ? thickness * 1.5 : thickness;
      protecting.current = nearDoor && Math.abs(viewSignedDist) < releaseDist;
    }

    const activeMesh = protecting.current ? box : door;
    if (protecting.current) {
      // The box extrudes through the plane AWAY from the camera. The near
      // plane reaches ~nearCornerDistance past the camera center, so in the
      // final stretch before the teleport fires (camera center crossing) it
      // pokes through the door plane — the box must extend beyond the plane
      // to keep the screen covered. Its front face stays flush with the door.
      box.scale.z = thickness;
      box.position.z = (viewSignedDist >= 0 ? -0.5 : 0.5) * thickness;
    }
    activeMesh.updateWorldMatrix(true, false);
    door.visible = !protecting.current;
    box.visible = protecting.current;
    self.activeMesh = activeMesh;

    const paired = getPortal(pairedId);
    if (!paired) return;

    // ---- Frustum cull: skip render if the portal surface is outside the
    // observer's view ----
    const selfRadius = Math.max(width, height) * 0.7 + thickness;
    if (!isSphereVisible(mainCam.projectionMatrix, _viewMatInv, self.position, selfRadius)) return;

    // Skip back-face render only when far away (optimization)
    if (viewSignedDist < 0 && viewDist > activationDistance * 0.5) return;

    // ---- Frame throttle: reduce render rate when distant ----
    frameCounter.current++;
    if (viewDist > FULL_RATE_DIST && frameCounter.current % THROTTLE_FRAMES !== 0) return;

    // virtualCam = destPortal * rotY(pi) * inv(srcPortal) * observer — the
    // same matrix the teleport system applies, so preview and teleport agree.
    getPortalPairMatrix(self.invMatrix, paired.matrix, _virtualMat).multiply(_viewMat);
    virtualCamera.matrixWorld.copy(_virtualMat);
    virtualCamera.matrixWorldInverse.copy(_virtualMat).invert();
    _virtualMat.decompose(virtualCamera.position, virtualCamera.quaternion, virtualCamera.scale);

    // Match main camera projection (context observers share it — they are
    // rigid transforms of the main camera), then clip everything behind the
    // destination portal so it doesn't bleed into the preview.
    virtualCamera.fov = mainCam.fov;
    virtualCamera.aspect = mainCam.aspect;
    virtualCamera.near = mainCam.near;
    virtualCamera.far = mainCam.far;
    virtualCamera.updateProjectionMatrix();
    applyObliqueNearClip(virtualCamera, paired.position, paired.quaternion);

    // ---- Texture matrix (projective mapping, in the OBSERVER's view) ----
    // Note: the observer's real render may use an oblique projection (when it
    // is itself a portal's virtual camera), but oblique clipping only alters
    // the z row of the projection matrix — x/y/w, which texture2DProj uses,
    // are identical. So the standard projection is valid for both.
    const texMat = uniforms.textureMatrix.value as THREE.Matrix4;
    texMat.copy(_biasMatrix);
    texMat.multiply(mainCam.projectionMatrix);
    texMat.multiply(_viewMatInv);
    texMat.multiply(activeMesh.matrixWorld);

    // ---- Adaptive resolution: scale render target to the portal's
    // screen-space coverage, quantized so the target isn't reallocated on
    // every frame of player movement ----
    gl.getDrawingBufferSize(_drawSize);
    const fovRad = THREE.MathUtils.degToRad(mainCam.fov * 0.5);
    const screenFraction = (Math.max(width, height) * 0.5) / (Math.max(viewDist, 0.01) * Math.tan(fovRad));
    const resScale = Math.min(
      MAX_RES_SCALE,
      Math.max(MIN_RES_SCALE, Math.ceil(screenFraction / RES_SCALE_STEP) * RES_SCALE_STEP),
    );
    const targetW = Math.max(1, (_drawSize.x * resScale) | 0);
    const targetH = Math.max(1, (_drawSize.y * resScale) | 0);
    if (renderTarget.width !== targetW || renderTarget.height !== targetH) {
      renderTarget.setSize(targetW, targetH);
    }

    // ---- Render scene from virtual camera into render target ----
    // Restore objects hidden by main-camera frustum culling for exit portals
    if (direction === "exit") {
      restoreFrustumVisibility();
    }
    activeMesh.visible = false; // hide portal mesh to prevent recursion
    hideForeignPortalMeshes(portals.current, self);

    // Skip shadow map re-computation during portal render
    const prevShadows = gl.shadowMap.enabled;
    gl.shadowMap.enabled = false;

    // Match clear color to scene background
    gl.getClearColor(_savedClearColor);
    const savedClearAlpha = gl.getClearAlpha();
    if (scene.background && (scene.background as any).isColor) {
      gl.setClearColor(scene.background as THREE.Color);
    }

    const prevTarget = gl.getRenderTarget();
    const prevXr = gl.xr.enabled;
    gl.xr.enabled = false;
    gl.setRenderTarget(renderTarget);
    gl.clear();
    gl.render(scene, virtualCamera);
    gl.setRenderTarget(prevTarget);
    gl.xr.enabled = prevXr;
    gl.shadowMap.enabled = prevShadows;
    gl.setClearColor(_savedClearColor, savedClearAlpha);

    restoreForeignPortalMeshes(portals.current, self);
    if (direction === "exit") {
      hideFrustumObjects();
    }
    hasRendered.current = true;
    activeMesh.visible = true;
  }, direction === "exit" ? 0.9 : 1);

  return { doorMeshRef, boxMeshRef, doorMaterial, boxMaterial };
};
