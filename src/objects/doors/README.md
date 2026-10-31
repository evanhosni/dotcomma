# Doors

## How it works

THE hinged door, shared by buildings and the sewers' side rooms ([door.ts](door.ts)). Its owner keeps the open state and the colliders: building doors sync through the server, sewer doors are client-local.

- **Geometry** (`makeDoorGeometry(width, height, color, handle)`): a leaf 0.16u wider and 0.2u taller than its opening, 0.1u thick (a closed door shows no gap at its jambs and header), its middle 0.05u over the opening's middle, running along +x from the hinge; a spindle through the leaf 0.4u in from the free edge at a third of the height, and on both faces either a round knob (r 0.11) or a lever (0.42 × 0.07 × 0.08u, set back 0.17u toward the hinge) standing 0.16u off the face, in the handle's color. Vertex-colored (one material serves every leaf), uv dropped. Returns the leaf's box too (`DoorLeafBox`), for far stand-ins. Buildings keep their exact previous look.
- **Swing** (`swingDoors(hinges, open, delta, onAngle?)`): eases each hinge toward 0 or `DOOR_OPEN_ANGLE` (−1.9 rad, toward +z) at 4/s, snapping within 1e-3, recomposes the hinge's matrices (frozen subtrees), reports each angle that moved (buildings mirror it onto their far doors) and returns whether anything still moves.
- **Hover** (`hoveredDoor(camera, leaves, reach)`): the nearest visible leaf hit by the screen-center ray within reach, or −1.
- [types.ts](types.ts) is Three-free: building specs, which the server imports, name a `DoorHandle` (re-exported from `building/types.ts`).

## How to use

Put a group at the opening's middle, turned so its +z is the side the door opens to; inside it a hinge group at x = −width/2 holding a mesh of the leaf geometry. Drive `swingDoors` from the owner's frame while anything moves, and pick with `hoveredDoor`. The click path stays the owner's (buildings listen for their own door clicks; the sewers on a window listener while a target is hovered).
