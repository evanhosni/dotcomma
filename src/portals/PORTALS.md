# Portal System

## Overview

The portal system teleports the player between the outdoor world (ground level) and indoor worlds (at Y=10000). Each portal is a paired set: an **enter portal** (outdoor door) and an **exit portal** (indoor door). The portal mesh displays a real-time render of the destination scene via a virtual camera, using Valve-style projective texture mapping.

## Architecture

### Files

- `Portal.tsx` — Core portal component: crossing detection, virtual camera rendering, teleportation
- `PortalContext.tsx` — Shared state: `pendingTeleport`, `transitioning`, portal transform registry, `enterIndoor`/`exitIndoor` functions
- `PortalBuilding.tsx` — Test building with enter portal + always-mounted `IndoorWorldVisuals`
- `types.ts` — `INDOOR_Y_OFFSET` (10000), `IndoorWorldProps`
- `worlds/IndoorWorld.tsx` — Room visuals, room colliders, exit portal
- `worlds/registry.ts` — Indoor world registry (id/urlPath/component mapping)

### Component Mount Order (affects useFrame execution)

```
Physics (rapier step)
  Terrain
  ObjectPool → GameObjects
  PortalBuilding → Enter Portal, IndoorWorldVisuals → Exit Portal
  ActiveIndoorWorld (conditional colliders)
  Player
```

Portal's `useFrame` runs BEFORE Player's. This matters for crossing detection timing.

### Portal Pair Setup

The enter portal is in `PortalBuilding` at the building's front door. The exit portal is in `IndoorWorldVisuals` (always mounted) at the indoor room's front door. They reference each other via `id`/`pairedId` strings. Each portal registers its world transform every frame so the paired portal can look it up.

## Rendering Pipeline

1. Portal's `useFrame` computes the virtual camera position: `destPortal * rot180 * inv(srcPortal) * mainCamera`
2. Oblique near-plane clipping (Lengyel method) clips geometry behind the destination portal surface
3. Scene is rendered from the virtual camera into a `WebGLRenderTarget`
4. The portal mesh displays the render target via projective texture mapping (shader maps mesh vertices to screen-space UVs)
5. `isXRRenderTarget + SRGBColorSpace` trick ensures tone mapping matches the main render

### Rendering Decisions Use Camera Position

The back-face check, frame throttle, and adaptive resolution in the rendering section use `camera.position` (not the body position used for crossing detection). This is critical because the body can cross the portal plane while the camera is still in front due to lerp lag. If body-based `signedDist` were used, the portal texture would stop rendering while the camera can still see it.

## Crossing Detection & Teleportation

### Current Approach: Body-Center Crossing at Threshold 0

The portal reads `rb.translation()` (player rigid body center) and triggers when `signedDist` crosses 0 — i.e., when the player's center passes the portal plane.

On the teleport frame, the camera is snapped to the destination immediately (before the scene renders) to prevent any visual flash.

### `behindAndRetreating` Fallback

If the player ends up behind the portal (signedDist < 0) — which can happen when barely crossing the enter portal places them behind the exit portal — and they're moving further away (signedDist decreasing), the teleport triggers. This prevents the player from getting stuck behind the portal.

### Extended Floor Collider

`IndoorWorld`'s floor collider has `HALF + 1` Z extent (1 unit past the front wall) to provide ground for players who land behind the exit portal.

## Known Issues & Solutions Explored

### Issue 1: Visual Flash on Forward Walk-Through (RESOLVED)

**Problem:** When the player walked forward through the portal, there was a brief visual flash. The camera's near plane clipped the portal mesh before the teleport triggered.

**Root cause:** Portal's `useFrame` runs before Player's in the frame loop. It was reading `playerPosition` (set by Player on the previous frame), creating a one-frame lag. The camera could advance past the portal before crossing was detected. The original threshold (`camera.near + 0.05 ≈ 0.15`) was too close.

**Solutions tried:**
- Camera position prediction (predict where camera will be after Player's lerp) — worked but added coupling to Player constants
- Body-center crossing at threshold 0 — simpler, works because the body is always ahead of the camera
- Camera snap on teleport frame — prevents any flash by snapping the camera to the destination before the scene renders

**Current solution:** Body-center crossing + camera snap.

### Issue 2: Visual Flash on Backward Walk-Through (PARTIALLY RESOLVED)

**Problem:** Walking backward through the portal still flashed.

**Solutions tried:**
- Adaptive threshold based on camera facing direction (`max(0.05, 0.5 * facing)`) — made things worse, introduced edge cases where the threshold changed while the player was in the trigger zone
- `movingThroughZone` fallback condition — added complexity
- YXZ euler order fix for yaw delta — `camera.rotation.y += yawDelta` uses XYZ order but PointerLockControls uses YXZ, corrupting pitch. This was identified but reverted.

**Current status:** The body-center crossing + camera snap handles most cases. Backward transitions are abrupt (the portal isn't visible) but don't have rendering artifacts.

### Issue 3: Player Falls from Y=10000 After Barely Entering (RESOLVED)

**Problem:** Barely crossing the enter portal placed the player behind the exit portal (signedDist < 0 from exit), outside the indoor room's floor colliders. The player fell from Y=10000.

**Root cause:** The portal transform maps "in front of source" to "behind destination" (Valve-style). The floor collider didn't extend past the exit portal.

**Solutions tried:**
- Clamping teleport destination to always be in front of paired portal — caused a visible 0.3-unit visual jump
- Extending floor collider + `behindAndRetreating` detection — current solution
- `PORTAL_BUFFER` approach: teleport at a buffer distance, land at a buffer distance past the exit — cleanest but requires matching the virtual camera offset

**Current solution:** Extended floor collider (HALF + 1) + `behindAndRetreating` fallback.

### Issue 4: Near-Plane Clipping of Portal Mesh

**Problem:** The camera's near plane clipped the portal mesh when very close.

**Solutions tried:**
- `camera.near = 0` — causes complete z-fighting (depth buffer can't represent infinite ratio)
- `camera.near = 0.01` — current setting, practical minimum with `far = 7200`
- Vertex shader z-clamp: `gl_Position.z = max(gl_Position.z, -gl_Position.w)` — prevents GPU near-plane clipping but breaks when vertices are behind the camera (w <= 0, causes projection math to produce garbage x/y)
- View-space z-clamp: `viewPos.z = min(viewPos.z, -0.001)` — same fundamental problem
- Subdividing portal geometry to 16x16 segments — helps the z-clamp work because center vertices stay valid when edge vertices are behind the camera
- `frustumCulled={false}` on portal meshes — prevents Three.js CPU-side frustum culling but doesn't affect GPU clipping
- **Two-plane approach:** Split into trigger plane (at portal position) and visual plane (offset behind by `VISUAL_OFFSET`). Player teleports before reaching the visual mesh, so clipping can't happen.

**Key insight from research:** GPU near-plane clipping can't be reliably bypassed in the vertex shader for geometry that spans the camera plane. When vertices end up behind the camera, `w` becomes negative/zero and the perspective divide produces garbage. The z-clamp only works for vertices that are close to but still in front of the camera. Subdividing the geometry (16x16) makes the clamp viable because individual triangles near the center remain valid.

**Current state:** The vertex shader has the z-clamp (`gl_Position.z = max(gl_Position.z, -gl_Position.w)`), geometry is 16x16 subdivided, and the visual mesh can optionally be offset behind the trigger plane via `VISUAL_OFFSET`.

### Issue 5: Object Flash When Exiting Indoor World (RESOLVED)

**Problem:** Outdoor objects briefly disappeared for one frame when exiting the indoor world.

**Root cause:** GameObjects' `useFrame` runs before Portal's. On the teleport frame, GameObjects frustum-culled outdoor objects using the indoor camera position (Y=10000). Portal then snapped the camera to ground level, but objects were already `visible = false`.

**Solution:** After the camera snap on exit, restore `frustumHiddenObjects` visibility:
```js
if (direction === "exit") {
    frustumHiddenObjects.forEach((obj) => { obj.visible = true; });
}
```

### Issue 6: Objects in Portal Texture Not Rendering (OPEN)

**Problem:** When standing close to a portal, objects visible through it take a few frames to appear or don't render.

**Root cause:** `frustumHiddenObjects` restore during virtual camera render was gated to exit-only (`if (direction === "exit")`). Also, Three.js's built-in `frustumCulled` check on individual meshes still rejects objects during `gl.render(scene, virtualCamera)` even after setting `visible = true`.

**Solution needed:** Remove the direction gate so both portal types restore objects. Temporarily set `frustumCulled = false` on restored objects during the portal render:
```js
frustumHiddenObjects.forEach((obj) => {
    obj.visible = true;
    obj.frustumCulled = false; // disable Three.js built-in culling
});
// ... gl.render(scene, virtualCamera) ...
frustumHiddenObjects.forEach((obj) => {
    obj.visible = false;
    obj.frustumCulled = true; // restore
});
```

**Current file status:** The `direction === "exit"` gate is still present and the `frustumCulled` fix has not been applied. This needs to be fixed.

### Issue 7: Euler Order Mismatch for Yaw Delta (IDENTIFIED, NOT FIXED)

**Problem:** `camera.rotation.y += yawDelta` uses XYZ euler order but PointerLockControls manages the camera quaternion using YXZ. When the camera has pitch (looking up/down), the XYZ modification corrupts the orientation.

**Correct fix:**
```js
if (yawDelta !== 0) {
    _yawEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    _yawEuler.y += yawDelta;
    camera.quaternion.setFromEuler(_yawEuler);
}
```

This applies to both Portal.tsx (camera snap) and Player.tsx (pending teleport handling). Was implemented but reverted — should be re-applied.

## Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `INDOOR_Y_OFFSET` | 10000 | `types.ts` | Y separation between outdoor and indoor worlds |
| `PLAYER_EYE_OFFSET` | 1.0 | `Portal.tsx` | Must match `PLAYER_HEIGHT * 0.5` in Player.tsx |
| `CLIP_BIAS` | 0.01 | `Portal.tsx` | Oblique clip plane offset to avoid z-clipping the portal surface |
| `VISUAL_OFFSET` | 0.3 | `Portal.tsx` | (when used) Visual mesh offset behind trigger plane |
| `PORTAL_BUFFER` | varies | `Portal.tsx` | (when used) Teleport trigger distance + arrival offset |
| `MIN_RES_SCALE` | 0.15 | `Portal.tsx` | Minimum portal render resolution |
| `MAX_RES_SCALE` | 1.0 | `Portal.tsx` | Maximum portal render resolution |
| `FULL_RATE_DIST` | 15 | `Portal.tsx` | Beyond this, portal renders at reduced frame rate |
| `THROTTLE_FRAMES` | 3 | `Portal.tsx` | Frame skip count when throttled |
| `activationDistance` | 50 | Per-portal prop | Distance at which portal becomes active |

## Design Decisions

### Why `playerPosition` vs `rb.translation()` vs Camera Position

- **`playerPosition`** (GameContext): Set by Player at end of its `useFrame`. One frame behind when Portal reads it. Was the original approach.
- **`rb.translation()`**: Current physics body position after this frame's physics step. More current than `playerPosition`. Used for crossing detection.
- **`camera.position`**: Where the camera actually renders from. Lags behind body due to `CAMERA_LERP`. Used for rendering decisions (back-face check, throttle, resolution).

### Why Not Physics Sensors

Rapier sensor colliders were considered for crossing detection. They fire during the physics step (before `useFrame`), eliminating timing issues. However, they require filtering by collider type, direction checking, and wiring teleport logic through callbacks rather than the existing `useFrame` flow. The body-center crossing approach was simpler.

### Two-Plane Architecture (Visual + Trigger)

Splitting the portal into a trigger plane (at the portal position) and a visual plane (offset behind it) ensures the player teleports BEFORE reaching the rendered surface. This completely avoids near-plane clipping without shader hacks. The trigger plane is invisible — only the visual mesh renders. The offset should be small enough (0.3 units) that the projective texture mapping still looks correct.
