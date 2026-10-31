/** The devmode checkboxes, in panel order (menus/overlay/DevOverlay.tsx draws them). Each `flag` becomes a
 *  boolean on the dev context — read it with `useDevContext().<flag>`; it reads false while devmode is off,
 *  and the selection is saved to the device (save/) so devmode comes back with it. `key` is the function key
 *  that flips it (unmodified, devmode only). */
export const DEV_TOGGLES = [
  { flag: "noclip", label: "noclip", key: "F1" },
  { flag: "physicsDebug", label: "physics debug", key: "F2" },
  { flag: "tintSkirts", label: "tint skirts", key: "F3" },
  { flag: "noLodFade", label: "no LOD fade", key: "F4" },
  { flag: "flashlight", label: "flashlight", key: "F5" },
] as const;
