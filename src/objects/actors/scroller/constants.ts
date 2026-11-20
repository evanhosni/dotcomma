/** Paint jobs; each is ONE shared material (objects/actors/scroller/material.ts). */
export const SCROLLER_COLORS = [
  "#d8d8d2", // office beige-white
  "#2b2b30", // graphite
  "#c4302b",
  "#e0822c",
  "#e6c63a",
  "#4fa34a",
  "#2f8f8a",
  "#2f62c4",
  "#6a3fb8",
  "#d0508f",
  "#8a8f99",
  "#6b4a2e",
] as const;

/** The body (a dynamic Rapier body) exists inside this camera distance; beyond it the car is drawn only. */
export const BODY_DISTANCE = 140;
export const BODY_DISTANCE_HYSTERESIS = 20;
/** Frames between the hover ray tests. */
export const HOVER_INTERVAL_FRAMES = 3;
/** Units either side of the spawn point the road field is sampled at: its slope gives the street's heading. */
export const HEADING_PROBE = 1.5;
