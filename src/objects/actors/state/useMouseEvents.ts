import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { hideCursor, showCursor } from "../../../utils/cursor/cursor";
import type { SyncHandle } from "../../../net/entities/useSyncedEntity";
import { mouseActionOf, type MouseFlag } from "./runner";
import type { StateMachineHandle } from "./useStateMachine";

/**
 * MOUSE EVENTS for a state-machine actor: a throttled screen-center raycast
 * against the model's skinned meshes raises one-shot flags on the machine's
 * blackboard (hover enter/leave, clicks, scroll) that the mouse TRIGGERS in
 * triggers.ts read. Owned by ModelActor for every actor with a state machine;
 * `sm === null` (no machine) makes the hook inert.
 *
 * MULTIPLAYER: the SERVER runs a synced actor's machine, so EVERY input raised
 * here is also forwarded (`entity:interact "mouse-<flag>"`, runner.ts
 * mouseActionOf) — the server raises the same flag there and the machine's own
 * triggers decide. Inputs cross the wire, never triggers. The cursor grow stays
 * a local effect. The owner passes the current sync handle into `tick`.
 */

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
  /** Seed for the every-3-frames raycast throttle — pass a per-instance
   *  value (hash of spawn coords) so batch-mounted actors don't all raycast
   *  on the same frame. */
  framePhase?: number;
}

export interface MouseEventsHandle {
  /** Call from the owner's actor `onFrame`. `distanceSq` is the actor base's
   *  2D squared camera distance — a lower bound on the 3D one, so it gates
   *  the raycast for free; `sync` is the actor's sync handle (null = local). */
  tick: (camera: THREE.Camera, distanceSq: number, sync: SyncHandle | null) => void;
}

/** Raise a one-shot mouse flag on a blackboard (the dirty bit lets the state
 *  machine clear the one-shot set only on frames where something was raised)
 *  and forward the same INPUT to the server when this actor is synced. */
const raise = (bb: Record<string, any>, flag: MouseFlag, sync: SyncHandle | null): void => {
  bb[flag] = true;
  bb.__mouse_dirty = true;
  if (sync && sync.known) sync.interact(mouseActionOf(flag));
};

const DEFAULT_DISTANCE = 5;

// Angular pre-test: the manual raycast below does per-triangle CPU-skinned
// tests, and the bounding-sphere reject is inflated ×3 for animation so it
// rarely rejects — a miss used to scan every triangle of every mesh. The
// screen-center ray only ever hits an actor roughly IN FRONT of the camera,
// so reject outright unless the actor center is within ~18° of the view ray.
// Skipped when the actor is very close (it then spans a wide angle and the
// normalized direction is unstable).
const VIEW_CONE_COS = Math.cos((18 * Math.PI) / 180);
const VIEW_CONE_MIN_DIST_SQ = 16; // within 4u, run the full test regardless
const _toActor = new THREE.Vector3();

// Own raycaster — same approach as R3F: setFromCamera(center, camera) + intersectObject
const _raycaster = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);

// Scratch objects for the custom SkinnedMesh triangle test
const _worldSphere = new THREE.Sphere();
const _invMatrix = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _tA = new THREE.Vector3();
const _tB = new THREE.Vector3();
const _tC = new THREE.Vector3();
const _hitPt = new THREE.Vector3();

export function useMouseEvents(
  sm: StateMachineHandle | null,
  groupRef: React.MutableRefObject<THREE.Group | null>,
  options: UseMouseEventsOptions = {},
): MouseEventsHandle {
  const bb = sm?.blackboard ?? null;
  const growCursor = options.shouldGrowCursor ?? false;
  const activeHoverRef = useRef(false);
  const hitDistRef = useRef(Infinity);
  /** The sync handle as of the last tick — the DOM click handler forwards through it. */
  const syncRef = useRef<SyncHandle | null>(null);

  const d = useMemo(
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

  // Max distance at which any mouse event fires — nothing to do beyond this
  const maxEventDist = useMemo(
    () =>
      Math.max(
        d.hoverEnter, d.leftClick, d.rightClick, d.leftClickDown, d.rightClickDown,
        d.leftClickUp, d.rightClickUp, d.doubleClick, d.middleClick,
        d.scroll, d.scrollUp, d.scrollDown,
      ),
    [d],
  );

  // Raycast from screen center, throttled to every 3 frames
  const tick = (camera: THREE.Camera, distanceSq2D: number, sync: SyncHandle | null): void => {
    syncRef.current = sync;
    if (!bb) return;
    frameCountRef.current++;

    // Only raycast every 3 frames; reuse last result on skip frames
    if (frameCountRef.current % 3 !== 0) {
      return;
    }

    let isHovering = false;

    if (groupRef.current) {
      // Cheap distance pre-check — skip all geometry work if the player is
      // too far for any event to fire. The caller's 2D squared distance (when
      // driven by the actor base) rejects first without touching the group.
      // Add padding for object height/radius.
      const threshold = maxEventDist + 3;
      const thresholdSq = threshold * threshold;
      const dist3DSq =
        distanceSq2D > thresholdSq ? Infinity : camera.position.distanceToSquared(groupRef.current.position);

      if (dist3DSq > thresholdSq) {
        hitDistRef.current = Infinity;
      } else {
        _raycaster.setFromCamera(_center, camera);

        // Angular pre-test (see VIEW_CONE_COS above): the screen-center ray
        // can only hit an actor near the view direction — skip all
        // per-triangle work when it's off to the side or behind.
        _toActor.subVectors(groupRef.current.position, _raycaster.ray.origin);
        const outsideViewCone =
          dist3DSq > VIEW_CONE_MIN_DIST_SQ &&
          _toActor.normalize().dot(_raycaster.ray.direction) < VIEW_CONE_COS;

        if (outsideViewCone) {
          hitDistRef.current = Infinity;
        } else {
          // Cache SkinnedMesh references on first use, sorted largest-first
          // so the body mesh (most likely to hit) is tested before tiny face
          // meshes, maximising early-exit probability.
          if (cachedMeshesRef.current.length === 0) {
            groupRef.current.traverse((child) => {
              if ((child as THREE.SkinnedMesh).isSkinnedMesh)
                cachedMeshesRef.current.push(child as THREE.SkinnedMesh);
            });
            cachedMeshesRef.current.sort(
              (a, b) => (b.geometry.index?.count ?? 0) - (a.geometry.index?.count ?? 0),
            );
          }

          // Custom SkinnedMesh ray-triangle test. Three.js's built-in
          // intersectObject silently drops valid hits for SkinnedMesh instances
          // that mount after the initial batch (cause unknown — the geometry,
          // bones, and matrices are all correct). This manual test uses the
          // same data (getVertexPosition with bone transforms, local-space ray)
          // and reliably produces hits that intersectObject misses.
          let hitDist = Infinity;
          const meshes = cachedMeshesRef.current;

          for (let m = 0; m < meshes.length && hitDist > maxEventDist; m++) {
            const sm = meshes[m];
            const geo = sm.geometry;
            if (!geo.index) continue;

            // Quick bounding-sphere rejection in world space
            if (!geo.boundingSphere) geo.computeBoundingSphere();
            _worldSphere.copy(geo.boundingSphere!).applyMatrix4(sm.matrixWorld);
            _worldSphere.radius *= 3; // inflate for animation
            if (!_raycaster.ray.intersectsSphere(_worldSphere)) continue;

            // Build local-space ray
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
                break; // first hit is enough
              }
            }
          }
          hitDistRef.current = hitDist;
          if (hitDist <= d.hoverEnter) {
            isHovering = true;
          }
        }
      }
    }

    lastHoverRef.current = isHovering;

    if (isHovering && !activeHoverRef.current) {
      activeHoverRef.current = true;
      raise(bb, "__mouse_hover_enter", sync);
      bb.__mouse_hover_active = true;
      if (growCursor) showCursor();
    } else if (!isHovering && activeHoverRef.current) {
      activeHoverRef.current = false;
      raise(bb, "__mouse_hover_leave", sync);
      // Write false instead of delete — deleting keys forces the blackboard
      // into dictionary mode; truthiness semantics are identical
      bb.__mouse_hover_active = false;
      if (growCursor) hideCursor();
    }
  };
  const tickRef = useRef(tick);
  tickRef.current = tick;

  // DOM event listeners — use our manual raycast hit distance instead of
  // R3F's internal intersectObject (which has the same SkinnedMesh bug).
  useEffect(() => {
    if (!bb) return;
    const dist = () => hitDistRef.current;
    const input = (flag: MouseFlag) => raise(bb, flag, syncRef.current);

    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (dist() > d.leftClick) return;
      input("__mouse_left_click");
    };

    const handleContextMenu = () => {
      if (dist() > d.rightClick) return;
      input("__mouse_right_click");
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 0) {
        if (dist() > d.leftClickDown) return;
        input("__mouse_left_click_down");
      } else if (e.button === 1) {
        if (dist() > d.middleClick) return;
        input("__mouse_middle_click");
      } else if (e.button === 2) {
        if (dist() > d.rightClickDown) return;
        input("__mouse_right_click_down");
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.button === 0) {
        if (dist() > d.leftClickUp) return;
        input("__mouse_left_click_up");
      } else if (e.button === 2) {
        if (dist() > d.rightClickUp) return;
        input("__mouse_right_click");
        input("__mouse_right_click_up");
      }
    };

    const handleDblClick = () => {
      if (dist() > d.doubleClick) return;
      input("__mouse_double_click");
    };

    const handleWheel = (e: WheelEvent) => {
      if (dist() > d.scroll) return;
      input("__mouse_scroll");
      if (e.deltaY < 0 && dist() <= d.scrollUp) {
        input("__mouse_scroll_up");
      } else if (e.deltaY > 0 && dist() <= d.scrollDown) {
        input("__mouse_scroll_down");
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
  }, [bb, d]);

  // All events are handled via the DOM listeners + manual raycast above.
  // Deliberately NOTHING is attached to the R3F group — returning even no-op
  // pointer handlers registered every actor in R3F's interaction list,
  // triggering a recursive raycast (full CPU-skinned triangle tests) per
  // actor on every pointermove. The handle only exposes the frame tick.
  return useMemo<MouseEventsHandle>(() => ({ tick: (camera, distanceSq, sync) => tickRef.current(camera, distanceSq, sync) }), []);
}
