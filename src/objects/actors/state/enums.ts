/** One-shot flags written by useMouseEvents (client) or raised from a forwarded input (server). */
export const MOUSE_ONE_SHOT_FLAGS = [
  "__mouse_hover_enter",
  "__mouse_hover_leave",
  "__mouse_left_click",
  "__mouse_right_click",
  "__mouse_left_click_down",
  "__mouse_right_click_down",
  "__mouse_left_click_up",
  "__mouse_right_click_up",
  "__mouse_scroll",
  "__mouse_scroll_up",
  "__mouse_scroll_down",
  "__mouse_double_click",
  "__mouse_middle_click",
] as const;
