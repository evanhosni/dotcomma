import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { frustumHiddenObjects } from "../objects/GameObject";
import { usePortalContext } from "./PortalContext";

interface PortalProps {
  id: string;
  pairedId: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  size: [number, number];
  /** Actual portal mesh geometry (matches the shape of the GLTF portal object) */
  geometry: THREE.BufferGeometry;
  targetIndoorId: string;
  activationDistance: number;
  /** "enter" = outdoor→indoor, "exit" = indoor→outdoor */
  direction: "enter" | "exit";
  /** URL path for indoor world navigation. Default "/" (no URL change). */
  urlPath?: string;
}

// --- Projective-texture shaders (same technique as Three.js Reflector) ---
const VERT = `
uniform mat4 textureMatrix;
varying vec4 vPortalUv;
void main() {
  vPortalUv = textureMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = max(gl_Position.z, -gl_Position.w);
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

// --- Pre-allocated scratch objects (safe: useFrame is single-threaded) ---
const _portalPos = new THREE.Vector3();
const _portalNormal = new THREE.Vector3();
const _portalRight = new THREE.Vector3();
const _toPlayer = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

// Virtual camera transform
const _srcMat = new THREE.Matrix4();
const _srcMatInv = new THREE.Matrix4();
const _destMat = new THREE.Matrix4();
const _rot180 = new THREE.Matrix4().makeRotationY(Math.PI);
const _virtualMat = new THREE.Matrix4();
const _scale1 = new THREE.Vector3(1, 1, 1);

// Projective texture matrix: bias * proj * view * model → maps mesh verts to render-target UVs
const _biasMatrix = new THREE.Matrix4().set(
  0.5,
  0.0,
  0.0,
  0.5,
  0.0,
  0.5,
  0.0,
  0.5,
  0.0,
  0.0,
  0.5,
  0.5,
  0.0,
  0.0,
  0.0,
  1.0,
);

// Oblique near-plane clipping (Lengyel method)
const _clipNormal = new THREE.Vector3();
const _clipPoint = new THREE.Vector3();
const _clipNormalCam = new THREE.Vector3();
const _clipPointCam = new THREE.Vector3();
const _clipVec4 = new THREE.Vector4();
const _oblQ = new THREE.Vector4();
const _mat3 = new THREE.Matrix3();

// Teleport computation scratch objects
const _teleportPos = new THREE.Vector3();
const _relQuat = new THREE.Quaternion();
const _rotY180Quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _yawEuler = new THREE.Euler();

const PLAYER_EYE_OFFSET = 1.0; // PLAYER_HEIGHT * 0.5

const _drawSize = new THREE.Vector2();
const _savedClearColor = new THREE.Color();
const CLIP_BIAS = 0.01; // slight bias so the portal-surface geometry isn't z-clipped

// ---- Performance tuning ----
// Adaptive resolution: render target scales with portal's screen-space coverage.
// When far away (small on screen), far fewer pixels are shaded.
const MIN_RES_SCALE = 0.15;
const MAX_RES_SCALE = 1.0;
// Beyond this distance, only re-render portal texture every THROTTLE_FRAMES frames
const FULL_RATE_DIST = 15;
const THROTTLE_FRAMES = 3;
const PORTAL_FADE_RANGE = 10;

// Frustum culling scratch objects
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _boundSphere = new THREE.Sphere();

export const Portal = ({
  id,
  pairedId,
  position,
  rotation,
  size,
  geometry,
  targetIndoorId,
  activationDistance,
  direction,
  urlPath,
}: PortalProps) => {
  const {
    enterIndoor,
    exitIndoor,
    transitioning,
    registerPortal,
    unregisterPortal,
    getPortalTransform,
    playerRigidBodyRef,
    pendingYawDelta,
  } = usePortalContext();
  const { gl, scene, camera } = useThree();

  const activeRef = useRef(false);
  const hasTriggered = useRef(false);
  const wasTransitioning = useRef(false);
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const prevSignedDist = useRef<number | null>(null);
  const frameCounter = useRef(0);

  const [width, height] = size;

  // Persistent virtual camera
  const virtualCamera = useMemo(() => {
    const cam = new THREE.PerspectiveCamera();
    cam.matrixAutoUpdate = false;
    return cam;
  }, []);

  // Render target — resized each frame to match the drawing buffer.
  // isXRRenderTarget + SRGBColorSpace tricks Three.js into applying tone mapping
  // and sRGB encoding during the portal render, identical to screen output.
  // This ensures ALL materials (standard + custom terrain shaders) produce the
  // same pixel values as the main render — the portal shader just passes through.
  const renderTarget = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    (rt as any).isXRRenderTarget = true;
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  }, []);

  // Portal shader material — toneMapped:false because the render target already
  // contains fully processed (tone-mapped + sRGB) values; no extra processing needed.
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          textureMatrix: { value: new THREE.Matrix4() },
          portalTexture: { value: renderTarget.texture },
          portalOpacity: { value: 0 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        toneMapped: false,
      }),
    [renderTarget],
  );

  // Unregister on unmount
  useEffect(() => () => unregisterPortal(id), [id, unregisterPortal]);

  // Dispose GPU resources
  useEffect(
    () => () => {
      renderTarget.dispose();
      material.dispose();
    },
    [renderTarget, material],
  );

  // ---- Hook 1: activation + crossing detection + teleport (runs first) ----
  useFrame(() => {
    const group = groupRef.current;
    const rb = playerRigidBodyRef.current;
    if (!group || !rb) return;

    // ---- World transform of this portal ----
    group.getWorldPosition(_portalPos);
    group.getWorldQuaternion(_quat);
    _portalNormal.set(0, 0, 1).applyQuaternion(_quat);
    _portalRight.set(1, 0, 0).applyQuaternion(_quat);

    // Publish to registry so paired portals can find us
    registerPortal(id, _portalPos, _quat);

    // ---- Activation distance (based on player body center) ----
    const rbPos = rb.translation();
    _toPlayer.set(rbPos.x, rbPos.y, rbPos.z).sub(_portalPos);
    const dist = _toPlayer.length();
    const signedDist = _toPlayer.dot(_portalNormal);

    // Reset trigger when a transition finishes
    if (wasTransitioning.current && !transitioning.current) {
      hasTriggered.current = false;
      prevSignedDist.current = null;
    }
    wasTransitioning.current = transitioning.current;

    const cameraDist = camera.position.distanceTo(_portalPos);
    const shouldBeActive = dist < activationDistance || cameraDist < activationDistance;
    if (shouldBeActive !== activeRef.current) {
      activeRef.current = shouldBeActive;
      if (!shouldBeActive) {
        hasTriggered.current = false;
        prevSignedDist.current = null;
      }
    }

    // ---- Plane-crossing detection ----
    if (activeRef.current && !hasTriggered.current && !transitioning.current && prevSignedDist.current !== null) {
      const localX = _toPlayer.dot(_portalRight);
      const localY = _toPlayer.y;
      const inDoorFrame =
        Math.abs(localX) < width / 2 &&
        Math.abs(localY) < height / 2 + 1 && // +1 for player half-height
        Math.abs(signedDist) < 1.5;

      // Trigger on plane crossing in EITHER direction — GLTF portal normals may
      // face either way, so we can't assume which side is "front". A door can be
      // walked through from both sides. The 8-frame transitioning guard + null
      // prevSignedDist reset prevents bounce-back after teleporting.
      const crossedPlane =
        (prevSignedDist.current > 0 && signedDist <= 0) ||
        (prevSignedDist.current < 0 && signedDist >= 0);
      if (inDoorFrame && crossedPlane) {
        const paired = getPortalTransform(pairedId);
        if (paired) {
          hasTriggered.current = true;
          prevSignedDist.current = null;

          // Compute teleport destination: dest * rotY(π) * inv(src) * playerPos
          // The Valve formula rotates the player's offset to account for the
          // different facing directions of the enter/exit portals.
          _srcMat.compose(_portalPos, _quat, _scale1);
          _srcMatInv.copy(_srcMat).invert();
          _destMat.compose(paired.position, paired.quaternion, _scale1);

          _teleportPos.set(rbPos.x, rbPos.y, rbPos.z);
          _teleportPos.applyMatrix4(_srcMatInv);
          _teleportPos.applyMatrix4(_rot180);
          _teleportPos.applyMatrix4(_destMat);

          // Compute yaw delta from the portal-pair relative rotation
          _relQuat.copy(_quat).invert();
          _relQuat.premultiply(_rotY180Quat);
          _relQuat.premultiply(paired.quaternion);
          _yawEuler.setFromQuaternion(_relQuat, "YXZ");

          const dest = { x: _teleportPos.x, y: _teleportPos.y, z: _teleportPos.z };
          const yawDelta = _yawEuler.y;

          if (direction === "enter") {
            enterIndoor(targetIndoorId, urlPath ?? "/", _portalPos.clone(), _portalNormal.clone(), dest, yawDelta);
          } else {
            exitIndoor(dest, yawDelta);
          }

          // Snap camera to the destination immediately so THIS frame
          // renders from the teleport target — prevents the flash that
          // occurred when the camera's near plane clipped the portal mesh.
          camera.position.set(dest.x, dest.y + PLAYER_EYE_OFFSET, dest.z);
          // Apply yaw via quaternion premultiply — avoids the Euler gimbal
          // flip that occurs when modifying rotation.y with non-zero pitch.
          if (yawDelta !== 0) {
            _relQuat.setFromAxisAngle(_up, yawDelta);
            camera.quaternion.premultiply(_relQuat);
          }
          camera.updateMatrixWorld();
          pendingYawDelta.current = 0;

          // When exiting, GameObjects already ran frustum culling this frame
          // while the camera was still indoors — restore their visibility so
          // they render correctly from the new outdoor camera position.
          if (direction === "exit") {
            frustumHiddenObjects.forEach((obj) => { obj.visible = true; });
          }
        }
      }
    }
    prevSignedDist.current = signedDist;
  }, -1);

  // ---- Hook 2: virtual-camera rendering (runs after all portals activate + Player moves) ----
  useFrame(() => {
    const group = groupRef.current;
    const mesh = meshRef.current;
    if (!group || !mesh) return;

    // Recompute world transform (scratch objects may have been overwritten by
    // other portal instances' Hook 1 since it ran at a different priority).
    group.getWorldPosition(_portalPos);
    group.getWorldQuaternion(_quat);
    _portalNormal.set(0, 0, 1).applyQuaternion(_quat);

    // Re-check activation using the post-teleport camera position. This catches
    // the case where Hook 1 ran before a paired portal's teleport snapped the
    // camera nearby.
    if (!activeRef.current) {
      if (camera.position.distanceTo(_portalPos) < activationDistance) {
        activeRef.current = true;
      } else {
        return;
      }
    }

    // Rendering decisions use the camera position (not the body position
    // used for crossing detection) since the camera is what's actually seen.
    _toPlayer.copy(camera.position).sub(_portalPos);
    const cameraDist = _toPlayer.length();
    const cameraSignedDist = _toPlayer.dot(_portalNormal);

    // Distance-based fade: uses camera distance (body may lag by 1 frame
    // after a teleport since Player runs at priority -3, before portals).
    const fadeDist = cameraDist;
    material.uniforms.portalOpacity.value = Math.max(0, Math.min(1, (activationDistance - fadeDist) / PORTAL_FADE_RANGE));

    // Skip rendering when portal is fully transparent (out of range)
    if (material.uniforms.portalOpacity.value < 0.01) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    // Skip back-face render only when far away (optimization). When close
    // (e.g. just teleported), always render to avoid a black-frame flash —
    // GLTF normals may place the camera on the "back" side of the portal.
    if (cameraSignedDist < 0 && cameraDist > activationDistance * 0.5) return;

    const paired = getPortalTransform(pairedId);
    if (!paired) return;

    // ---- Frustum cull: skip render if portal quad is off-screen ----
    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);
    _boundSphere.set(_portalPos, Math.max(width, height) * 0.7);
    if (!_frustum.intersectsSphere(_boundSphere)) return;

    // ---- Frame throttle: reduce render rate when distant ----
    frameCounter.current++;
    if (cameraDist > FULL_RATE_DIST && frameCounter.current % THROTTLE_FRAMES !== 0) return;

    // Force-refresh camera matrices so we read this frame's position, not last
    // frame's. Three.js only recomputes matrixWorld / matrixWorldInverse inside
    // gl.render(), but Player has already moved the camera this frame (priority -2).
    // Camera.updateMatrixWorld also recomputes matrixWorldInverse.
    camera.updateMatrixWorld();

    // Build portal world matrices
    _srcMat.compose(_portalPos, _quat, _scale1);
    _srcMatInv.copy(_srcMat).invert();
    _destMat.compose(paired.position, paired.quaternion, _scale1);

    // virtualCam = destPortal * rotY(π) * inv(srcPortal) * playerCam
    _virtualMat.copy(_destMat).multiply(_rot180).multiply(_srcMatInv).multiply(camera.matrixWorld);

    virtualCamera.matrixWorld.copy(_virtualMat);
    virtualCamera.matrixWorldInverse.copy(_virtualMat).invert();
    _virtualMat.decompose(virtualCamera.position, virtualCamera.quaternion, virtualCamera.scale);

    // Match main camera projection
    const mainCam = camera as THREE.PerspectiveCamera;
    virtualCamera.fov = mainCam.fov;
    virtualCamera.aspect = mainCam.aspect;
    virtualCamera.near = mainCam.near;
    virtualCamera.far = mainCam.far;
    virtualCamera.updateProjectionMatrix();

    // ---- Oblique near-plane clipping (Lengyel method) ----
    // Clip plane sits on the paired portal's surface, normal facing into the destination scene.
    _clipNormal.set(0, 0, 1).applyQuaternion(paired.quaternion);
    _clipPoint.copy(paired.position).addScaledVector(_clipNormal, -CLIP_BIAS);

    // Transform clip plane into virtual camera space
    _mat3.setFromMatrix4(virtualCamera.matrixWorldInverse);
    _clipNormalCam.copy(_clipNormal).applyMatrix3(_mat3).normalize();
    _clipPointCam.copy(_clipPoint).applyMatrix4(virtualCamera.matrixWorldInverse);
    const d = -_clipNormalCam.dot(_clipPointCam);

    _clipVec4.set(_clipNormalCam.x, _clipNormalCam.y, _clipNormalCam.z, d);

    const p = virtualCamera.projectionMatrix.elements;
    _oblQ.x = (Math.sign(_clipVec4.x) + p[8]) / p[0];
    _oblQ.y = (Math.sign(_clipVec4.y) + p[9]) / p[5];
    _oblQ.z = -1.0;
    _oblQ.w = (1.0 + p[10]) / p[14];

    const scale = 2.0 / _clipVec4.dot(_oblQ);
    p[2] = _clipVec4.x * scale;
    p[6] = _clipVec4.y * scale;
    p[10] = _clipVec4.z * scale + 1.0;
    p[14] = _clipVec4.w * scale;

    virtualCamera.projectionMatrixInverse.copy(virtualCamera.projectionMatrix).invert();

    // ---- Texture matrix (projective mapping) ----
    // Use the MAIN camera's VP, not the virtual camera's. The Valve formula guarantees
    // that screen-space directions match between the two cameras, so the main camera's
    // screen position for each portal fragment maps to the correct render-target texel.
    // (Using the virtual camera's VP would place the portal mesh ~10000 units away in
    // virtual-camera space, collapsing all UVs to a single point.)
    const texMat = material.uniforms.textureMatrix.value as THREE.Matrix4;
    texMat.copy(_biasMatrix);
    texMat.multiply(camera.projectionMatrix);
    texMat.multiply(camera.matrixWorldInverse);
    texMat.multiply(mesh.matrixWorld);

    // ---- Render scene from virtual camera into render target ----
    // Adaptive resolution: scale render target to portal's screen-space coverage.
    // A portal that covers half the screen only needs ~half the pixels.
    gl.getDrawingBufferSize(_drawSize);
    const fovRad = THREE.MathUtils.degToRad(mainCam.fov * 0.5);
    const screenFraction = (Math.max(width, height) * 0.5) / (Math.max(cameraDist, 0.01) * Math.tan(fovRad));
    const resScale = Math.min(MAX_RES_SCALE, Math.max(MIN_RES_SCALE, screenFraction));
    const targetW = Math.max(1, (_drawSize.x * resScale) | 0);
    const targetH = Math.max(1, (_drawSize.y * resScale) | 0);
    if (renderTarget.width !== targetW || renderTarget.height !== targetH) {
      renderTarget.setSize(targetW, targetH);
    }

    // Restore objects hidden by main-camera frustum culling — only needed for
    // exit portals that look back at the outdoor world with GameObjects.
    // Enter portals face the indoor scene (Y=10000) where no GameObjects exist.
    if (direction === "exit") {
      frustumHiddenObjects.forEach((obj) => {
        obj.visible = true;
      });
    }
    mesh.visible = false; // hide portal mesh to prevent recursion

    // Skip shadow map re-computation during portal render
    const prevShadows = gl.shadowMap.enabled;
    gl.shadowMap.enabled = false;

    // Match clear color to scene background so sky isn't black in the render target
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

    if (direction === "exit") {
      frustumHiddenObjects.forEach((obj) => {
        obj.visible = false;
      });
    }
    mesh.visible = true;
  }, 1);

  const euler = rotation ? new THREE.Euler(...rotation) : undefined;

  return (
    <group ref={groupRef} position={position} rotation={euler}>
      {/* Start invisible — Hook 2 toggles visibility once the render target
          has been filled with a valid texture. Prevents a black-quad flash
          in other portals' virtual-camera renders on the very first frame. */}
      <mesh ref={meshRef} geometry={geometry} visible={false}>
        <primitive object={material} attach="material" />
      </mesh>
    </group>
  );
};
