import { ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { hideCursor, showCursor } from "../../utils/cursor/cursor";
import { StateMachineHandle } from "./types";

export interface MouseEventHandlers {
  onPointerOver: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut: (e: ThreeEvent<PointerEvent>) => void;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onContextMenu: (e: ThreeEvent<MouseEvent>) => void;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (e: ThreeEvent<PointerEvent>) => void;
  onDoubleClick: (e: ThreeEvent<MouseEvent>) => void;
  onWheel: (e: ThreeEvent<WheelEvent>) => void;
}

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
}

const DEFAULT_DISTANCE = 5;

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
  sm: StateMachineHandle,
  groupRef: React.MutableRefObject<THREE.Group | null>,
  options: UseMouseEventsOptions = {},
): MouseEventHandlers {
  const { scene } = useThree();
  const bb = sm.blackboard;
  const growCursor = options.shouldGrowCursor ?? false;
  const activeHoverRef = useRef(false);
  const hitDistRef = useRef(Infinity);

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

  const frameCountRef = useRef(0);
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
  useFrame(({ camera }) => {
    frameCountRef.current++;

    // Only raycast every 3 frames; reuse last result on skip frames
    if (frameCountRef.current % 3 !== 0) {
      return;
    }

    let isHovering = false;

    if (groupRef.current) {
      // Cheap 3D distance pre-check — skip all geometry work if the
      // player is too far for any event to fire
      const dist3DSq = camera.position.distanceToSquared(groupRef.current.position);
      // Add padding for object height/radius
      const threshold = maxEventDist + 3;

      if (dist3DSq > threshold * threshold) {
        hitDistRef.current = Infinity;
      } else {
        _raycaster.setFromCamera(_center, camera);

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

    lastHoverRef.current = isHovering;

    if (isHovering && !activeHoverRef.current) {
      activeHoverRef.current = true;
      bb.__mouse_hover_enter = true;
      bb.__mouse_hover_active = true;
      if (growCursor) showCursor();
    } else if (!isHovering && activeHoverRef.current) {
      activeHoverRef.current = false;
      bb.__mouse_hover_leave = true;
      delete bb.__mouse_hover_active;
      if (growCursor) hideCursor();
    }
  });

  // DOM event listeners — use our manual raycast hit distance instead of
  // R3F's internal intersectObject (which has the same SkinnedMesh bug).
  useEffect(() => {
    const dist = () => hitDistRef.current;

    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (dist() > d.leftClick) return;
      console.log("onMouseLeftClick");
      bb.__mouse_left_click = true;
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (dist() > d.rightClick) return;
      console.log("onMouseRightClick");
      bb.__mouse_right_click = true;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 0) {
        if (dist() > d.leftClickDown) return;
        console.log("onMouseLeftClickDown");
        bb.__mouse_left_click_down = true;
      } else if (e.button === 1) {
        if (dist() > d.middleClick) return;
        console.log("onMouseMiddleClick");
        bb.__mouse_middle_click = true;
      } else if (e.button === 2) {
        if (dist() > d.rightClickDown) return;
        console.log("onMouseRightClickDown");
        bb.__mouse_right_click_down = true;
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.button === 0) {
        if (dist() > d.leftClickUp) return;
        console.log("onMouseLeftClickUp");
        bb.__mouse_left_click_up = true;
      } else if (e.button === 2) {
        if (dist() > d.rightClickUp) return;
        console.log("onMouseRightClick");
        bb.__mouse_right_click = true;
        console.log("onMouseRightClickUp");
        bb.__mouse_right_click_up = true;
      }
    };

    const handleDblClick = () => {
      if (dist() > d.doubleClick) return;
      console.log("onMouseDoubleClick");
      bb.__mouse_double_click = true;
    };

    const handleWheel = (e: WheelEvent) => {
      if (dist() > d.scroll) return;
      console.log("onMouseScroll");
      bb.__mouse_scroll = true;
      if (e.deltaY < 0 && dist() <= d.scrollUp) {
        console.log("onMouseScrollUp");
        bb.__mouse_scroll_up = true;
      } else if (e.deltaY > 0 && dist() <= d.scrollDown) {
        console.log("onMouseScrollDown");
        bb.__mouse_scroll_down = true;
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

  // Return no-op handlers — events are now handled via DOM listeners above
  return useMemo(
    () => ({
      onPointerOver: (_e: ThreeEvent<PointerEvent>) => {},
      onPointerOut: (_e: ThreeEvent<PointerEvent>) => {},
      onClick: (_e: ThreeEvent<MouseEvent>) => {},
      onContextMenu: (_e: ThreeEvent<MouseEvent>) => {},
      onPointerDown: (_e: ThreeEvent<PointerEvent>) => {},
      onPointerUp: (_e: ThreeEvent<PointerEvent>) => {},
      onDoubleClick: (_e: ThreeEvent<MouseEvent>) => {},
      onWheel: (_e: ThreeEvent<WheelEvent>) => {},
    }),
    [],
  );
}
