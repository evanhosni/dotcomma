import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import * as THREE from "three";
import { RapierRigidBody } from "@react-three/rapier";
import { INDOOR_Y_OFFSET } from "./types";
import { getIndoorWorldByPath } from "./worlds/registry";

function updateUrlPath(newPath: string) {
  const url = new URL(window.location.href);
  url.pathname = newPath;
  window.history.replaceState(null, "", url.toString());
}

export interface PortalTransformData {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
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
}

const PortalContext = createContext<PortalContextType | undefined>(undefined);

const getInitialIndoorId = (): string | null => {
  const entry = getIndoorWorldByPath(window.location.pathname);
  return entry?.id ?? null;
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

      updateUrlPath(urlPath);
      setActiveIndoorId(id);
      requestAnimationFrame(() => {
        transitioning.current = false;
      });
    },
    [activeIndoorId],
  );

  const exitIndoor = useCallback(
    (teleportDest: { x: number; y: number; z: number }, yawDelta: number) => {
      if (activeIndoorId === null) return;
      transitioning.current = true;

      pendingTeleport.current = teleportDest;
      pendingYawDelta.current = yawDelta;

      updateUrlPath("/");
      setActiveIndoorId(null);
      requestAnimationFrame(() => {
        transitioning.current = false;
      });
    },
    [activeIndoorId],
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
      }}
    >
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
