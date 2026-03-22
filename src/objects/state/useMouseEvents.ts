import { ThreeEvent } from "@react-three/fiber";
import { useCallback, useMemo, useRef } from "react";
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

export function useMouseEvents(
  sm: StateMachineHandle,
  options: UseMouseEventsOptions = {},
): MouseEventHandlers {
  const bb = sm.blackboard;
  const growCursor = options.shouldGrowCursor ?? false;
  const activeHoverRef = useRef(false);

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

  const onPointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.distance > d.hoverEnter) return;
      if (!activeHoverRef.current) {
        activeHoverRef.current = true;
        console.log("onMouseHoverEnter");
        bb.__mouse_hover_enter = true;
        bb.__mouse_hover_active = true;
        if (growCursor) showCursor();
      }
    },
    [bb, d, growCursor],
  );

  const onPointerOut = useCallback(
    (_e: ThreeEvent<PointerEvent>) => {
      if (activeHoverRef.current) {
        activeHoverRef.current = false;
        console.log("onMouseHoverLeave");
        bb.__mouse_hover_leave = true;
        delete bb.__mouse_hover_active;
        if (growCursor) hideCursor();
      }
    },
    [bb, growCursor],
  );

  const onClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (e.distance > d.leftClick) return;
      console.log("onMouseLeftClick");
      bb.__mouse_left_click = true;
    },
    [bb, d],
  );

  const onContextMenu = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (e.distance > d.rightClick) return;
      console.log("onMouseRightClick");
      bb.__mouse_right_click = true;
    },
    [bb, d],
  );

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.button === 0) {
        if (e.distance > d.leftClickDown) return;
        console.log("onMouseLeftClickDown");
        bb.__mouse_left_click_down = true;
      } else if (e.button === 1) {
        if (e.distance > d.middleClick) return;
        console.log("onMouseMiddleClick");
        bb.__mouse_middle_click = true;
      } else if (e.button === 2) {
        if (e.distance > d.rightClickDown) return;
        console.log("onMouseRightClickDown");
        bb.__mouse_right_click_down = true;
      }
    },
    [bb, d],
  );

  const onPointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.button === 0) {
        if (e.distance > d.leftClickUp) return;
        console.log("onMouseLeftClickUp");
        bb.__mouse_left_click_up = true;
      } else if (e.button === 2) {
        if (e.distance > d.rightClickUp) return;
        console.log("onMouseRightClick");
        bb.__mouse_right_click = true;
        console.log("onMouseRightClickUp");
        bb.__mouse_right_click_up = true;
      }
    },
    [bb, d],
  );

  const onDoubleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (e.distance > d.doubleClick) return;
      console.log("onMouseDoubleClick");
      bb.__mouse_double_click = true;
    },
    [bb, d],
  );

  const onWheel = useCallback(
    (e: ThreeEvent<WheelEvent>) => {
      if (e.distance > d.scroll) return;
      bb.__mouse_scroll = true;
      console.log("onMouseScroll");
      if (e.deltaY < 0) {
        if (e.distance <= d.scrollUp) {
          console.log("onMouseScrollUp");
          bb.__mouse_scroll_up = true;
        }
      } else if (e.deltaY > 0) {
        if (e.distance <= d.scrollDown) {
          console.log("onMouseScrollDown");
          bb.__mouse_scroll_down = true;
        }
      }
    },
    [bb, d],
  );

  return useMemo(
    () => ({
      onPointerOver,
      onPointerOut,
      onClick,
      onContextMenu,
      onPointerDown,
      onPointerUp,
      onDoubleClick,
      onWheel,
    }),
    [onPointerOver, onPointerOut, onClick, onContextMenu, onPointerDown, onPointerUp, onDoubleClick, onWheel],
  );
}
