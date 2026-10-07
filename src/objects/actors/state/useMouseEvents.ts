import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { hideCursor, showCursor } from "../../../utils/cursor/cursor";
import type { SyncHandle } from "../../../net/entities/useSyncedEntity";
import { mouseActionOf, type MouseFlag } from "./runner";
import type { StateMachineHandle } from "./useStateMachine";

/**
 * A throttled screen-center raycast against the model's skinned meshes raises
 * one-shot flags on the machine's blackboard. Every input is ALSO forwarded to
 * the server (`entity:interact "mouse-<flag>"`) — inputs cross the wire, never
 * triggers; the server's machine evaluates its own triggers. `sm === null` makes
 * the hook inert.
 */

/** The hover raycast runs every this many frames (phase-offset per instance by `framePhase`). */
export const MOUSE_RAYCAST_INTERVAL_FRAMES = 3;

export interface UseMouseEventsOptions {
  /** Farthest ray distance (eye → hit) any input registers from — the actor's `interactReach`. */
  reach: number;
  shouldGrowCursor?: boolean;
  /** Per-instance seed (hash of spawn coords) so batch-mounted actors don't all raycast on the same frame. */
  framePhase?: number;
}

export interface MouseEventsHandle {
  /** `distanceSq` is the actor base's 2D squared distance — a lower bound on the 3D one. */
  tick: (camera: THREE.Camera, distanceSq: number, sync: SyncHandle | null) => void;
}

const raise = (bb: Record<string, any>, flag: MouseFlag, sync: SyncHandle | null): void => {
  bb[flag] = true;
  bb.__mouse_dirty = true;
  if (sync && sync.known) sync.interact(mouseActionOf(flag));
};

/** Past `reach`, padded for the model's height/radius: the camera is too far for any hit. */
const RAYCAST_RANGE_PAD = 3;

// Angular pre-test: the per-triangle CPU-skinned test below is expensive and the
// ×3-inflated sphere reject rarely rejects, so skip actors more than ~18° off the
// view ray — except very close ones, where the normalized direction is unstable.
const VIEW_CONE_COS = Math.cos((18 * Math.PI) / 180);
const VIEW_CONE_SKIP_WITHIN_SQ = 16;
/** Bounding spheres are inflated this much for animated poses. */
const ANIMATED_BOUNDS_INFLATE = 3;
const _toActor = new THREE.Vector3();

const _raycaster = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);

const _worldSphere = new THREE.Sphere();
const _invMatrix = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _tA = new THREE.Vector3();
const _tB = new THREE.Vector3();
const _tC = new THREE.Vector3();
const _hitPt = new THREE.Vector3();

/** Largest-first so the body mesh (most likely hit) is tested before tiny face meshes. */
const collectSkinnedMeshes = (group: THREE.Group, out: THREE.SkinnedMesh[]): void => {
  group.traverse((child) => {
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) out.push(child as THREE.SkinnedMesh);
  });
  out.sort((a, b) => (b.geometry.index?.count ?? 0) - (a.geometry.index?.count ?? 0));
};

/** Ray distance to the first triangle hit, testing meshes until one is hit within `reach`; Infinity if none.
 *  Manual ray-triangle test: three's intersectObject silently drops valid hits for SkinnedMeshes mounted
 *  after the initial batch (cause unknown — geometry, bones and matrices are all correct). Same data,
 *  reliable hits. */
const rayHitDistance = (ray: THREE.Ray, meshes: THREE.SkinnedMesh[], reach: number): number => {
  let hitDist = Infinity;
  for (let m = 0; m < meshes.length && hitDist > reach; m++) {
    const mesh = meshes[m];
    const geo = mesh.geometry;
    if (!geo.index) continue;

    if (!geo.boundingSphere) geo.computeBoundingSphere();
    _worldSphere.copy(geo.boundingSphere!).applyMatrix4(mesh.matrixWorld);
    _worldSphere.radius *= ANIMATED_BOUNDS_INFLATE;
    if (!ray.intersectsSphere(_worldSphere)) continue;

    _invMatrix.copy(mesh.matrixWorld).invert();
    _localRay.copy(ray).applyMatrix4(_invMatrix);

    const idx = geo.index;
    for (let i = 0, l = idx.count; i < l; i += 3) {
      mesh.getVertexPosition(idx.getX(i), _tA);
      mesh.getVertexPosition(idx.getX(i + 1), _tB);
      mesh.getVertexPosition(idx.getX(i + 2), _tC);
      if (_localRay.intersectTriangle(_tA, _tB, _tC, false, _hitPt)) {
        _hitPt.applyMatrix4(mesh.matrixWorld);
        hitDist = ray.origin.distanceTo(_hitPt);
        break;
      }
    }
  }
  return hitDist;
};

export function useMouseEvents(
  sm: StateMachineHandle | null,
  groupRef: React.MutableRefObject<THREE.Group | null>,
  options: UseMouseEventsOptions,
): MouseEventsHandle {
  const bb = sm?.blackboard ?? null;
  const growCursor = options.shouldGrowCursor ?? false;
  const reach = options.reach;
  const activeHoverRef = useRef(false);
  const hitDistRef = useRef(Infinity);
  const syncRef = useRef<SyncHandle | null>(null);
  const frameCountRef = useRef(options.framePhase ?? 0);
  const cachedMeshesRef = useRef<THREE.SkinnedMesh[]>([]);

  /** The screen-center ray's distance to the model; Infinity when out of range or off the view cone. */
  const measureHitDistance = (camera: THREE.Camera, group: THREE.Group, distanceSq2D: number): number => {
    const range = reach + RAYCAST_RANGE_PAD;
    const rangeSq = range * range;
    if (distanceSq2D > rangeSq) return Infinity;
    const dist3DSq = camera.position.distanceToSquared(group.position);
    if (dist3DSq > rangeSq) return Infinity;

    _raycaster.setFromCamera(_center, camera);
    _toActor.subVectors(group.position, _raycaster.ray.origin);
    const outsideViewCone =
      dist3DSq > VIEW_CONE_SKIP_WITHIN_SQ && _toActor.normalize().dot(_raycaster.ray.direction) < VIEW_CONE_COS;
    if (outsideViewCone) return Infinity;

    if (cachedMeshesRef.current.length === 0) collectSkinnedMeshes(group, cachedMeshesRef.current);
    return rayHitDistance(_raycaster.ray, cachedMeshesRef.current, reach);
  };

  const tick = (camera: THREE.Camera, distanceSq2D: number, sync: SyncHandle | null): void => {
    syncRef.current = sync;
    if (!bb) return;
    if (++frameCountRef.current % MOUSE_RAYCAST_INTERVAL_FRAMES !== 0) return;

    let isHovering = false;
    const group = groupRef.current;
    if (group) {
      hitDistRef.current = measureHitDistance(camera, group, distanceSq2D);
      isHovering = hitDistRef.current <= reach;
    }

    if (isHovering && !activeHoverRef.current) {
      activeHoverRef.current = true;
      raise(bb, "__mouse_hover_enter", sync);
      bb.__mouse_hover_active = true;
      if (growCursor) showCursor();
    } else if (!isHovering && activeHoverRef.current) {
      activeHoverRef.current = false;
      raise(bb, "__mouse_hover_leave", sync);
      // false, not delete: deleting keys forces the blackboard into dictionary mode.
      bb.__mouse_hover_active = false;
      if (growCursor) hideCursor();
    }
  };
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!bb) return;
    const inReach = () => hitDistRef.current <= reach;
    const input = (flag: MouseFlag) => raise(bb, flag, syncRef.current);

    const handleClick = (e: MouseEvent) => {
      if (e.button === 0 && inReach()) input("__mouse_left_click");
    };

    const handleContextMenu = () => {
      if (inReach()) input("__mouse_right_click");
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (!inReach()) return;
      if (e.button === 0) input("__mouse_left_click_down");
      else if (e.button === 1) input("__mouse_middle_click");
      else if (e.button === 2) input("__mouse_right_click_down");
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!inReach()) return;
      if (e.button === 0) {
        input("__mouse_left_click_up");
      } else if (e.button === 2) {
        input("__mouse_right_click");
        input("__mouse_right_click_up");
      }
    };

    const handleDblClick = () => {
      if (inReach()) input("__mouse_double_click");
    };

    const handleWheel = (e: WheelEvent) => {
      if (!inReach()) return;
      input("__mouse_scroll");
      if (e.deltaY < 0) input("__mouse_scroll_up");
      else if (e.deltaY > 0) input("__mouse_scroll_down");
    };

    window.addEventListener("click", handleClick);
    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("dblclick", handleDblClick);
    window.addEventListener("wheel", handleWheel);

    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("dblclick", handleDblClick);
      window.removeEventListener("wheel", handleWheel);
    };
  }, [bb, reach]);

  // NOTHING is attached to the R3F group: even no-op pointer handlers register the
  // actor in R3F's interaction list, which raycasts it recursively on every pointermove.
  return useMemo<MouseEventsHandle>(() => ({ tick: (camera, distanceSq, sync) => tickRef.current(camera, distanceSq, sync) }), []);
}
