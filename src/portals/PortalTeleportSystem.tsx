import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../context/GameContext";
import { CROSSING_DEPTH_THRESHOLD, CROSSING_HALF_HEIGHT_TOLERANCE } from "./constants";
import { getPortalPairMatrix, getPortalPairYaw } from "./portalMath";
import { PortalDescriptor, usePortalContext } from "./PortalContext";

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

// Per-indoor nearest active enter portal. Entry OBJECTS are reused across
// frames (reset, not reallocated) — a fresh {id, dist} literal per nearby
// enter portal per frame was steady garbage.
const _nearestEnter = new Map<string, { id: string | null; distSq: number }>();
// Exit portals collected during the main pass so the contextEnterId write
// below doesn't re-walk the whole portal map a second time.
const _exitPortals: PortalDescriptor[] = [];

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
    let previewDistSq = Infinity;
    for (const entry of _nearestEnter.values()) {
      entry.id = null;
      entry.distSq = Infinity;
    }
    _exitPortals.length = 0;

    for (const portal of portals.current.values()) {
      // Collected before any continue/break so the contextEnterId pass sees
      // (almost) every exit portal — see the note on `break` below.
      if (portal.direction === "exit") _exitPortals.push(portal);
      // Squared distances everywhere — comparisons only, no sqrt per portal.
      const distSq = camera.position.distanceToSquared(portal.position);
      if (distSq > portal.activationDistance * portal.activationDistance) {
        prev.delete(portal.id);
        continue;
      }
      if (portal.direction === "enter") {
        if (distSq < previewDistSq) {
          previewDistSq = distSq;
          previewId = portal.targetIndoorId;
        }
        let nearest = _nearestEnter.get(portal.targetIndoorId);
        if (!nearest) {
          nearest = { id: null, distSq: Infinity };
          _nearestEnter.set(portal.targetIndoorId, nearest);
        }
        if (distSq < nearest.distSq) {
          nearest.id = portal.id;
          nearest.distSq = distSq;
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
    // (On the rare teleport frame the `break` above leaves exits not yet
    // iterated out of _exitPortals — they keep last frame's context for one
    // frame, which matches _nearestEnter itself being partial on that frame.)
    for (const portal of _exitPortals) {
      portal.contextEnterId = _nearestEnter.get(portal.targetIndoorId)?.id ?? null;
    }

    previewIndoorIdRef.current = previewId;
  }, -2);

  return null;
};
