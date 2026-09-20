import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { hideCursor, showCursor } from "../../../utils/cursor/cursor";
import { StateMachineHandle } from "./types";
import type { SyncHandle } from "../../../net/entities/useSyncedEntity";

export interface MouseEventDistances {
  onMouseHoverEnter?: number;
  onMouseHoverLeave?: number;
  onMouseLeftClick?: number;
  onMouseRightClick?: number;
  onMouseLeftClickDown?: number;
  onMouseRightClickDown?: number;
  onMouseLeftClickUp?: number;
  onMouseRightClickUp?: number;
  onMouseScroll?: number;
  onMouseScrollUp?: number;
  onMouseScrollDown?: number;
  onMouseDoubleClick?: number;
  onMouseMiddleClick?: number;
}

export interface UseMouseEventsOptions {
  distances?: MouseEventDistances;
  shouldGrowCursor?: boolean;
  /** Per-instance phase for the every-3-frames raycast throttle. */
  framePhase?: number;
  /** The owner calls `tick` from its actor onFrame instead of this hook owning a useFrame. */
  externallyDriven?: boolean;
}

export interface MouseEventsHandle {
  tick: (camera: THREE.Camera, distanceSq?: number) => void;
}

/** The dirty bit lets the machine clear the one-shot set only on frames something was raised. */
const raise = (bb: Record<string, any>, flag: string): void => {
  bb[flag] = true;
  bb.__mouse_dirty = true;
};

const DEFAULT_DISTANCE = 5;

// Angular pre-test: the ×3-inflated sphere reject rarely rejects, and a miss
// scanned every CPU-skinned triangle of every mesh. Skipped very close, where
// the actor spans a wide angle.
const VIEW_CONE_COS = Math.cos((18 * Math.PI) / 180);
const VIEW_CONE_SKIP_WITHIN_SQ = 16; // within 4u, run the full test regardless
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

export function useMouseEvents(
  sm: StateMachineHandle,
  groupRef: React.MutableRefObject<THREE.Group | null>,
  options: UseMouseEventsOptions = {},
): MouseEventsHandle {
  const bb = sm.blackboard;
  const growCursor = options.shouldGrowCursor ?? false;
  const activeHoverRef = useRef(false);
  const hitDistRef = useRef(Infinity);

  const distances = useMemo(
    () => ({
      hoverEnter: options.distances?.onMouseHoverEnter ?? DEFAULT_DISTANCE,
      leftClick: options.distances?.onMouseLeftClick ?? DEFAULT_DISTANCE,
      rightClick: options.distances?.onMouseRightClick ?? DEFAULT_DISTANCE,
      leftClickDown: options.distances?.onMouseLeftClickDown ?? DEFAULT_DISTANCE,
      rightClickDown: options.distances?.onMouseRightClickDown ?? DEFAULT_DISTANCE,
      leftClickUp: options.distances?.onMouseLeftClickUp ?? DEFAULT_DISTANCE,
      rightClickUp: options.distances?.onMouseRightClickUp ?? DEFAULT_DISTANCE,
      doubleClick: options.distances?.onMouseDoubleClick ?? DEFAULT_DISTANCE,
      middleClick: options.distances?.onMouseMiddleClick ?? DEFAULT_DISTANCE,
      scroll: options.distances?.onMouseScroll ?? DEFAULT_DISTANCE,
      scrollUp: options.distances?.onMouseScrollUp ?? DEFAULT_DISTANCE,
      scrollDown: options.distances?.onMouseScrollDown ?? DEFAULT_DISTANCE,
    }),
    [options.distances],
  );

  const frameCountRef = useRef(options.framePhase ?? 0);
  const lastHoverRef = useRef(false);

  const cachedMeshesRef = useRef<THREE.SkinnedMesh[]>([]);

  const maxEventDist = useMemo(
    () =>
      Math.max(
        distances.hoverEnter, distances.leftClick, distances.rightClick, distances.leftClickDown, distances.rightClickDown,
        distances.leftClickUp, distances.rightClickUp, distances.doubleClick, distances.middleClick,
        distances.scroll, distances.scrollUp, distances.scrollDown,
      ),
    [distances],
  );

  const tick = (camera: THREE.Camera, distanceSq2D = 0): void => {
    frameCountRef.current++;

    if (frameCountRef.current % 3 !== 0) {
      return;
    }

    let isHovering = false;

    if (groupRef.current) {
      // The 2D squared distance is a lower bound on the 3D one, so it rejects first for free.
      const threshold = maxEventDist + 3;
      const thresholdSq = threshold * threshold;
      const dist3DSq =
        distanceSq2D > thresholdSq ? Infinity : camera.position.distanceToSquared(groupRef.current.position);

      if (dist3DSq > thresholdSq) {
        hitDistRef.current = Infinity;
      } else {
        _raycaster.setFromCamera(_center, camera);

        _toActor.subVectors(groupRef.current.position, _raycaster.ray.origin);
        const outsideViewCone =
          dist3DSq > VIEW_CONE_SKIP_WITHIN_SQ &&
          _toActor.normalize().dot(_raycaster.ray.direction) < VIEW_CONE_COS;

        if (outsideViewCone) {
          hitDistRef.current = Infinity;
        } else {
          // Largest-first so the body mesh is tested before tiny face meshes.
          if (cachedMeshesRef.current.length === 0) {
            groupRef.current.traverse((child) => {
              if ((child as THREE.SkinnedMesh).isSkinnedMesh)
                cachedMeshesRef.current.push(child as THREE.SkinnedMesh);
            });
            cachedMeshesRef.current.sort(
              (a, b) => (b.geometry.index?.count ?? 0) - (a.geometry.index?.count ?? 0),
            );
          }

          // Manual SkinnedMesh triangle test: three's intersectObject silently
          // drops valid hits for SkinnedMeshes mounted after the initial batch
          // (cause unknown); this uses the same data and reliably hits.
          let hitDist = Infinity;
          const meshes = cachedMeshesRef.current;

          for (let m = 0; m < meshes.length && hitDist > maxEventDist; m++) {
            const sm = meshes[m];
            const geo = sm.geometry;
            if (!geo.index) continue;

            if (!geo.boundingSphere) geo.computeBoundingSphere();
            _worldSphere.copy(geo.boundingSphere!).applyMatrix4(sm.matrixWorld);
            _worldSphere.radius *= 3; // inflate for animation
            if (!_raycaster.ray.intersectsSphere(_worldSphere)) continue;

            _invMatrix.copy(sm.matrixWorld).invert();
            _localRay.copy(_raycaster.ray).applyMatrix4(_invMatrix);

            const idx = geo.index;
            for (let i = 0, l = idx.count; i < l; i += 3) {
              sm.getVertexPosition(idx.getX(i), _tA);
              sm.getVertexPosition(idx.getX(i + 1), _tB);
              sm.getVertexPosition(idx.getX(i + 2), _tC);
              if (_localRay.intersectTriangle(_tA, _tB, _tC, false, _hitPt)) {
                _hitPt.applyMatrix4(sm.matrixWorld);
                hitDist = _raycaster.ray.origin.distanceTo(_hitPt);
                break;
              }
            }
          }
          hitDistRef.current = hitDist;
          if (hitDist <= distances.hoverEnter) {
            isHovering = true;
          }
        }
      }
    }

    lastHoverRef.current = isHovering;

    if (isHovering && !activeHoverRef.current) {
      activeHoverRef.current = true;
      raise(bb, "__mouse_hover_enter");
      bb.__mouse_hover_active = true;
      if (growCursor) showCursor();
    } else if (!isHovering && activeHoverRef.current) {
      activeHoverRef.current = false;
      raise(bb, "__mouse_hover_leave");
      // false, not delete: deleting keys forces the blackboard into dictionary mode.
      bb.__mouse_hover_active = false;
      if (growCursor) hideCursor();
    }
  };
  const tickRef = useRef(tick);
  tickRef.current = tick;

  const externallyDriven = options.externallyDriven ?? false;
  useFrame(({ camera }) => {
    if (!externallyDriven) tickRef.current(camera);
  });

  useEffect(() => {
    const dist = () => hitDistRef.current;

    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (dist() > distances.leftClick) return;
      raise(bb, "__mouse_left_click");
      // Forwarded to the server's machine (left click only; hover stays local).
      const h = groupRef.current?.userData.sync as SyncHandle | undefined;
      if (h && h.known) h.interact("mouse-left-click");
    };

    const handleContextMenu = () => {
      if (dist() > distances.rightClick) return;
      raise(bb, "__mouse_right_click");
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 0) {
        if (dist() > distances.leftClickDown) return;
        raise(bb, "__mouse_left_click_down");
      } else if (e.button === 1) {
        if (dist() > distances.middleClick) return;
        raise(bb, "__mouse_middle_click");
      } else if (e.button === 2) {
        if (dist() > distances.rightClickDown) return;
        raise(bb, "__mouse_right_click_down");
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.button === 0) {
        if (dist() > distances.leftClickUp) return;
        raise(bb, "__mouse_left_click_up");
      } else if (e.button === 2) {
        if (dist() > distances.rightClickUp) return;
        raise(bb, "__mouse_right_click");
        raise(bb, "__mouse_right_click_up");
      }
    };

    const handleDblClick = () => {
      if (dist() > distances.doubleClick) return;
      raise(bb, "__mouse_double_click");
    };

    const handleWheel = (e: WheelEvent) => {
      if (dist() > distances.scroll) return;
      raise(bb, "__mouse_scroll");
      if (e.deltaY < 0 && dist() <= distances.scrollUp) {
        raise(bb, "__mouse_scroll_up");
      } else if (e.deltaY > 0 && dist() <= distances.scrollDown) {
        raise(bb, "__mouse_scroll_down");
      }
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
  }, [bb, distances]);

  // Deliberately NOTHING is attached to the R3F group: even no-op pointer
  // handlers put every actor in R3F's interaction list — a recursive
  // CPU-skinned raycast per actor on every pointermove.
  return useMemo<MouseEventsHandle>(() => ({ tick: (camera, distanceSq) => tickRef.current(camera, distanceSq) }), []);
}
