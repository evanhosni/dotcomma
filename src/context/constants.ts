/** The devmode checkboxes, in panel order (menus/overlay/DevOverlay.tsx draws them). Each `flag` becomes a
 *  boolean on the dev context — read it with `useDevContext().<flag>`; it reads false while devmode is off,
 *  and the selection is saved to the device (save/) so devmode comes back with it. */
export const DEV_TOGGLES = [
  { flag: "noclip", label: "noclip" },
  { flag: "physicsDebug", label: "physics debug" },
  { flag: "tintSkirts", label: "tint skirts" },
  { flag: "noLodFade", label: "no LOD fade" },
] as const;
