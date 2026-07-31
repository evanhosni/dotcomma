import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../context/GameContext";
import { CROSSING_DEPTH_THRESHOLD, CROSSING_HALF_HEIGHT_TOLERANCE } from "./constants";
import { getPortalPairMatrix, getPortalPairYaw } from "./portalMath";
import { usePortalContext } from "./PortalContext";

/**
 * Central plane-crossing detector + teleporter (one useFrame for ALL portals).
 *
 * The teleport fires the moment the CAMERA crosses a portal plane inside the
 * door frame — not when the player body does. At that instant the portal
 * surface (an extruded box, see usePortalRenderer) fills the entire screen
 * with the destination view, so applying the pair transform to the camera and
 * body produces a frame that is pixel-identical to the previous one. No
 * transition guards, physics freezes, or camera snapping needed.
 *
 * Runs at priority -2: after Player movement (-3), before object culling (0)
 * and portal rendering (1) — everything downstream sees post-teleport state.
 */

const _local = new THREE.Vector3();
const _pairMat = new THREE.Matrix4();
const _bodyPos = new THREE.Vector3();
const _yawQuat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

// Per-indoor nearest active enter portal (reused each frame)
const _nearestEnter = new Map<string, { id: string; dist: number }>();

export const PortalTeleportSystem = () => {
  const { portals, playerRigidBodyRef, enterIndoor, exitIndoor, previewIndoorIdRef } = usePortalContext();
  const { playerPosition } = useGameContext();
  const { camera } = useThree();

  // Signed distance to each nearby portal's plane on the previous frame
  const prevSide = useRef(new Map<string, number>());

  useFrame(() => {
    const rb = playerRigidBodyRef.current;
    const prev = prevSide.current;

    let previewId: string | null = null;
    let previewDist = Infinity;
    _nearestEnter.clear();

    for (const portal of portals.current.values()) {
      const dist = camera.position.distanceTo(portal.position);
      if (dist > portal.activationDistance) {
        prev.delete(portal.id);
        continue;
      }
      if (portal.direction === "enter") {
        if (dist < previewDist) {
          previewDist = dist;
          previewId = portal.targetIndoorId;
        }
        const nearest = _nearestEnter.get(portal.targetIndoorId);
        if (!nearest || dist < nearest.dist) {
          _nearestEnter.set(portal.targetIndoorId, { id: portal.id, dist });
        }
      }

      // Camera position in portal-local space: x/y span the door, z is the
      // signed distance to the plane.
      _local.copy(camera.position).applyMatrix4(portal.invMatrix);
      const side = _local.z;
      const last = prev.get(portal.id);
      prev.set(portal.id, side);
      if (last === undefined || !rb) continue;

      // Crossing in EITHER direction — GLTF door normals may face either way,
      // and a door can be walked through from both sides.
      const crossed = (last > 0 && side <= 0) || (last < 0 && side >= 0);
      const inDoorFrame =
        Math.abs(_local.x) < portal.halfWidth &&
        Math.abs(_local.y) < portal.halfHeight + CROSSING_HALF_HEIGHT_TOLERANCE;
      // Reject sign flips caused by large warps (respawns, dev flight)
      const shallow =
        Math.abs(side) < CROSSING_DEPTH_THRESHOLD && Math.abs(last) < CROSSING_DEPTH_THRESHOLD;
      if (!crossed || !inDoorFrame || !shallow) continue;

      const paired = portals.current.get(portal.pairedId);
      if (!paired) continue;

      // One rigid transform, applied to body and camera alike — their relative
      // offset (eye height, camera lerp lag) is preserved exactly.
      getPortalPairMatrix(portal.invMatrix, paired.matrix, _pairMat);

      const rbPos = rb.translation();
      _bodyPos.set(rbPos.x, rbPos.y, rbPos.z).applyMatrix4(_pairMat);
      rb.setTranslation({ x: _bodyPos.x, y: _bodyPos.y, z: _bodyPos.z }, true);
      rb.setNextKinematicTranslation({ x: _bodyPos.x, y: _bodyPos.y, z: _bodyPos.z });
      playerPosition.set(_bodyPos.x, _bodyPos.y, _bodyPos.z);

      camera.position.applyMatrix4(_pairMat);
      const yaw = getPortalPairYaw(portal.quaternion, paired.quaternion);
      if (yaw !== 0) {
        _yawQuat.setFromAxisAngle(_up, yaw);
        camera.quaternion.premultiply(_yawQuat);
      }
      // Downstream frame hooks (culling, portal renders) must see this frame's
      // true camera transform.
      camera.updateMatrixWorld();

      // Hand plane-tracking to the destination portal with its true post-
      // teleport signed distance, so it doesn't see a phantom crossing.
      prev.delete(portal.id);
      _local.copy(camera.position).applyMatrix4(paired.invMatrix);
      prev.set(paired.id, _local.z);

      if (portal.direction === "enter") {
        enterIndoor(portal.targetIndoorId, portal.urlPath);
      } else {
        exitIndoor();
      }
      break; // at most one teleport per frame
    }

    // Tell each exit portal which enter portal (if any) is its current viewing
    // context, so it can render the exterior inside that portal's preview.
    for (const portal of portals.current.values()) {
      if (portal.direction === "exit") {
        portal.contextEnterId = _nearestEnter.get(portal.targetIndoorId)?.id ?? null;
      }
    }

    previewIndoorIdRef.current = previewId;
  }, -2);

  return null;
};
