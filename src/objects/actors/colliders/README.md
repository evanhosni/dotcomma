# GLTF colliders

## How it works

A `<ModelActor>` with `body: "fixed"` (the default) builds its physics shapes from its **model file**. Kinematic NPCs use the capsule from their spec instead, and `body: "none"` gets nothing.

- [collider.ts](collider.ts) `createColliders(gltf, scale, rotation, wholeTrimesh, modelUrl, excludeNames)` walks the model and ships each tagged mesh's geometry (typed-array copies, transferred) to [collider.worker.ts](collider.worker.ts). The worker fits the shape off the main thread. Results are cached per model + scale + rotation + options, so each model is processed once.
- [Colliders.tsx](Colliders.tsx) has the Rapier components (`CapsuleCollider`, `SphereCollider`, `BoxCollider`, `TrimeshCollider`) that `ModelActor` mounts. They mount only inside the actor's `colliderDistance` (default `min(500, renderDistance / 2)`), gated by the actor base with a global activation throttle. `collidersNeverMove: false` makes them follow a moving actor.
- [types.ts](types.ts) holds the worker message and collider prop types.

**How a mesh becomes a collider.** Only the model's top-level mesh children are checked. Each one is classified by a GLTF **custom property** (`userData`):

| custom property on the mesh | collider |
|---|---|
| `capsule` | capsule fitted to the mesh's bounds |
| `sphere` | sphere fitted to the bounds |
| `box` | box fitted to the bounds |
| `trimesh` | the exact triangles |

An untagged mesh gets no collider. The tagged mesh is **not** hidden by code, so it still renders. Use visible geometry, or hide it in the model.

`wholeTrimesh: true` on the descriptor ignores the tags and makes one trimesh from every mesh in the model, minus the names in `excludeColliderNames`.

These colliders exist only on the client. The server does not load GLTFs, so server-simulated NPCs walk through GLTF props.

## How to use/add

N/A for the system. To make a model solid:

1. In Blender, select the collider mesh (a top-level object, not nested). Under Object Properties → Custom Properties, add `box` (or `capsule` / `sphere` / `trimesh`) with value `1`.
2. Export the glTF with **Include → Custom Properties** checked, into `public/models/`.
3. Nothing to set on the descriptor. Or skip the tagging and set `wholeTrimesh: true`, which is simplest but the most expensive for detailed models.
