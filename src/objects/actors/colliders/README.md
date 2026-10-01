# GLTF colliders

## How it works

A `<ModelActor>` with `body: "fixed"` builds its physics shapes from its model file (kinematic NPCs use their spec's capsule; `body: "none"` gets nothing).

- [collider.ts](collider.ts) `createColliders(…)` walks the model's top-level meshes and sends each tagged mesh's geometry to [collider.worker.ts](collider.worker.ts), which fits the shape off-thread. Results are cached per model + scale + rotation + options.
- Each mesh is classified by a GLTF custom property: `capsule`, `sphere`, `box` (fitted to its bounds) or `trimesh` (exact triangles). Untagged meshes get nothing; tagged meshes still render.
- `wholeTrimesh: true` skips the tags and makes one trimesh of the whole model, minus `excludeColliderNames`.
- [Colliders.tsx](Colliders.tsx) holds the Rapier components ModelActor mounts within the actor's `colliderDistance`; [types.ts](types.ts) holds the message and prop types.
- Client only: the server does not load GLTFs.

## How to add another

1. In Blender, on a top-level collider mesh, add a custom property `box` / `capsule` / `sphere` / `trimesh`.
2. Export glTF with Include → Custom Properties into `public/models/`.
3. Or skip tagging and set `wholeTrimesh: true` on the spec.
