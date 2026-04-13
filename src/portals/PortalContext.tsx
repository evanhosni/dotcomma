import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import * as THREE from "three";
import { RapierRigidBody } from "@react-three/rapier";
import { IndoorLightRig } from "./IndoorLightRig";

function updateUrlPath(newPath: string) {
  const url = new URL(window.location.href);
  url.pathname = newPath;
  window.history.replaceState(null, "", url.toString());
}

export interface PortalTransformData {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export interface IndoorBounds {
  /** World-space center of the indoor volume */
  center: THREE.Vector3;
  /** World-space size of the indoor volume */
  size: THREE.Vector3;
}

interface PortalContextType {
  activeIndoorId: string | null;
  enterIndoor: (id: string, urlPath: string, portalWorldPos: THREE.Vector3, portalNormal: THREE.Vector3, teleportDest: { x: number; y: number; z: number }, yawDelta: number) => void;
  exitIndoor: (teleportDest: { x: number; y: number; z: number }, yawDelta: number) => void;
  playerRigidBodyRef: React.MutableRefObject<RapierRigidBody | null>;
  verticalVelocityRef: React.MutableRefObject<number>;
  transitioning: React.MutableRefObject<boolean>;
  entryPortalPos: React.MutableRefObject<THREE.Vector3>;
  savedOutdoorPos: React.MutableRefObject<THREE.Vector3>;
  pendingTeleport: React.MutableRefObject<{ x: number; y: number; z: number } | null>;
  pendingYawDelta: React.MutableRefObject<number>;
  registerPortal: (id: string, position: THREE.Vector3, quaternion: THREE.Quaternion) => void;
  unregisterPortal: (id: string) => void;
  getPortalTransform: (id: string) => PortalTransformData | undefined;
  /** Indoor bounds registry — buildings publish their world-space interior
   *  bounds so IndoorLightRig can position lights for the active indoor. */
  publishIndoorBounds: (id: string, bounds: IndoorBounds) => void;
  unpublishIndoorBounds: (id: string) => void;
  getIndoorBounds: (id: string) => IndoorBounds | undefined;
}

const PortalContext = createContext<PortalContextType | undefined>(undefined);

const getInitialIndoorId = (): string | null => {
  return null;
};

export const PortalContextProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [activeIndoorId, setActiveIndoorId] = useState<string | null>(getInitialIndoorId);
  const playerRigidBodyRef = useRef<RapierRigidBody | null>(null);
  const verticalVelocityRef = useRef(0);
  const transitioning = useRef(false);
  const entryPortalPos = useRef(new THREE.Vector3());
  const entryPortalNormal = useRef(new THREE.Vector3());
  const savedOutdoorPos = useRef(new THREE.Vector3());
  const pendingTeleport = useRef<{ x: number; y: number; z: number } | null>(null);
  const pendingYawDelta = useRef(0);

  // Portal transform registry — portals register their world transforms each frame
  const portalTransforms = useRef(new Map<string, PortalTransformData>());

  const registerPortal = useCallback((id: string, pos: THREE.Vector3, quat: THREE.Quaternion) => {
    let data = portalTransforms.current.get(id);
    if (!data) {
      data = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
      portalTransforms.current.set(id, data);
    }
    data.position.copy(pos);
    data.quaternion.copy(quat);
  }, []);

  const unregisterPortal = useCallback((id: string) => {
    portalTransforms.current.delete(id);
  }, []);

  const getPortalTransform = useCallback((id: string): PortalTransformData | undefined => {
    return portalTransforms.current.get(id);
  }, []);

  // Indoor bounds registry (used by IndoorLightRig to place lights at the
  // active indoor's world-space center each frame).
  const indoorBoundsMap = useRef(new Map<string, IndoorBounds>());

  const publishIndoorBounds = useCallback((id: string, bounds: IndoorBounds) => {
    indoorBoundsMap.current.set(id, bounds);
  }, []);

  const unpublishIndoorBounds = useCallback((id: string) => {
    indoorBoundsMap.current.delete(id);
  }, []);

  const getIndoorBounds = useCallback(
    (id: string): IndoorBounds | undefined => indoorBoundsMap.current.get(id),
    [],
  );

  // Clear transitioning after several frames so the player has time to move
  // away from the paired portal, preventing immediate bounce-back teleports.
  const clearTransitionAfterFrames = useCallback((frames: number) => {
    let remaining = frames;
    const tick = () => {
      if (--remaining > 0) {
        requestAnimationFrame(tick);
      } else {
        transitioning.current = false;
      }
    };
    requestAnimationFrame(tick);
  }, []);

  const enterIndoor = useCallback(
    (id: string, urlPath: string, portalWorldPos: THREE.Vector3, portalNormal: THREE.Vector3, teleportDest: { x: number; y: number; z: number }, yawDelta: number) => {
      if (activeIndoorId === id) return;
      transitioning.current = true;
      entryPortalPos.current.copy(portalWorldPos);
      entryPortalNormal.current.copy(portalNormal);

      const rb = playerRigidBodyRef.current;
      if (rb) {
        const pos = rb.translation();
        savedOutdoorPos.current.set(pos.x, pos.y, pos.z);
      }

      pendingTeleport.current = teleportDest;
      pendingYawDelta.current = yawDelta;

      if (urlPath !== "/") updateUrlPath(urlPath);
      setActiveIndoorId(id);
      clearTransitionAfterFrames(8);
    },
    [activeIndoorId, clearTransitionAfterFrames],
  );

  const exitIndoor = useCallback(
    (teleportDest: { x: number; y: number; z: number }, yawDelta: number) => {
      if (activeIndoorId === null) return;
      transitioning.current = true;

      pendingTeleport.current = teleportDest;
      pendingYawDelta.current = yawDelta;

      updateUrlPath("/");
      setActiveIndoorId(null);
      clearTransitionAfterFrames(8);
    },
    [activeIndoorId, clearTransitionAfterFrames],
  );

  return (
    <PortalContext.Provider
      value={{
        activeIndoorId,
        enterIndoor,
        exitIndoor,
        playerRigidBodyRef,
        verticalVelocityRef,
        transitioning,
        entryPortalPos,
        savedOutdoorPos,
        pendingTeleport,
        pendingYawDelta,
        registerPortal,
        unregisterPortal,
        getPortalTransform,
        publishIndoorBounds,
        unpublishIndoorBounds,
        getIndoorBounds,
      }}
    >
      <IndoorLightRig />
      {children}
    </PortalContext.Provider>
  );
};

export const usePortalContext = (): PortalContextType => {
  const context = useContext(PortalContext);
  if (!context) {
    throw new Error("usePortalContext must be used within a PortalContextProvider");
  }
  return context;
};
