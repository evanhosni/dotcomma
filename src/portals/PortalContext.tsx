import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import * as THREE from "three";
import { RapierRigidBody } from "@react-three/rapier";
import { IndoorLightRig } from "./IndoorLightRig";
import { PortalTeleportSystem } from "./PortalTeleportSystem";

function updateUrlPath(newPath: string) {
  const url = new URL(window.location.href);
  url.pathname = newPath;
  window.history.replaceState(null, "", url.toString());
}

/** Everything the teleport system and renderer need to know about a portal.
 *  Registered once by the Portal component — portals are static. */
export interface PortalDescriptor {
  id: string;
  pairedId: string;
  direction: "enter" | "exit";
  targetIndoorId: string;
  urlPath: string;
  activationDistance: number;
  halfWidth: number;
  halfHeight: number;
  /** World transform (local +z is the portal normal) */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  matrix: THREE.Matrix4;
  invMatrix: THREE.Matrix4;
  /** For exit portals: the same-building enter portal the player is currently
   *  near (set per frame by PortalTeleportSystem). When the main camera is far
   *  but this is set, the exit portal renders in "context mode" — observed by
   *  that enter portal's virtual camera — so it shows the exterior inside the
   *  enter portal's interior preview (one level of portal recursion). */
  contextEnterId: string | null;
  /** The mesh currently representing this portal (door or protection box) —
   *  lets other portals' render passes hide surfaces that would sample their
   *  texture from the wrong camera. */
  activeMesh: THREE.Mesh | null;
  /** Scratch for visibility save/restore during portal render passes */
  prevVisible?: boolean;
}

export interface IndoorBounds {
  /** World-space center of the indoor volume */
  center: THREE.Vector3;
  /** World-space size of the indoor volume */
  size: THREE.Vector3;
}

interface PortalContextType {
  activeIndoorId: string | null;
  enterIndoor: (id: string, urlPath: string) => void;
  exitIndoor: () => void;
  playerRigidBodyRef: React.MutableRefObject<RapierRigidBody | null>;
  /** Portal registry — the teleport system iterates this each frame. */
  portals: React.MutableRefObject<Map<string, PortalDescriptor>>;
  registerPortal: (descriptor: PortalDescriptor) => void;
  unregisterPortal: (id: string) => void;
  getPortal: (id: string) => PortalDescriptor | undefined;
  /** Indoor whose enter-portal preview is currently visible — lets the light
   *  rig illuminate an interior BEFORE the player steps in, so the portal
   *  preview matches what they see after teleporting. */
  previewIndoorIdRef: React.MutableRefObject<string | null>;
  /** Indoor bounds registry — buildings publish their world-space interior
   *  bounds so IndoorLightRig can position lights for the active indoor. */
  publishIndoorBounds: (id: string, bounds: IndoorBounds) => void;
  unpublishIndoorBounds: (id: string) => void;
  getIndoorBounds: (id: string) => IndoorBounds | undefined;
}

const PortalContext = createContext<PortalContextType | undefined>(undefined);

export const PortalContextProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [activeIndoorId, setActiveIndoorId] = useState<string | null>(null);
  const playerRigidBodyRef = useRef<RapierRigidBody | null>(null);
  const previewIndoorIdRef = useRef<string | null>(null);

  const portals = useRef(new Map<string, PortalDescriptor>());

  const registerPortal = useCallback((descriptor: PortalDescriptor) => {
    portals.current.set(descriptor.id, descriptor);
  }, []);

  const unregisterPortal = useCallback((id: string) => {
    portals.current.delete(id);
  }, []);

  const getPortal = useCallback((id: string): PortalDescriptor | undefined => {
    return portals.current.get(id);
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

  const enterIndoor = useCallback((id: string, urlPath: string) => {
    if (urlPath !== "/") updateUrlPath(urlPath);
    setActiveIndoorId(id);
  }, []);

  const exitIndoor = useCallback(() => {
    updateUrlPath("/");
    setActiveIndoorId(null);
  }, []);

  return (
    <PortalContext.Provider
      value={{
        activeIndoorId,
        enterIndoor,
        exitIndoor,
        playerRigidBodyRef,
        portals,
        registerPortal,
        unregisterPortal,
        getPortal,
        previewIndoorIdRef,
        publishIndoorBounds,
        unpublishIndoorBounds,
        getIndoorBounds,
      }}
    >
      <PortalTeleportSystem />
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
