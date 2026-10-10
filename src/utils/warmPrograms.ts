import * as THREE from "three";

/**
 * PROGRAM WARM-UP at domain load (CLAUDE.md Performance Notes → "Programs link at LOAD"). three links
 * a program synchronously inside the first draw that needs it, so every kind of streamed content that
 * first appears mid-play costs one hitch (10–185ms per program). uploadOnFirstDraw moves the link to
 * the MOUNT frame, which is still mid-play.
 *
 * Each template is drawn ONCE in the real scene — its lights are part of the program key — collapsed
 * to a point (a zero-scale holder: no fragments), then removed; on three r158+ its programs are first
 * linked off the main thread (compileAsync, see bindProgramCompiler). A template must match the real object
 * in everything that keys the program: the material, Mesh vs InstancedMesh, instanceColor, skinning,
 * morph targets. The class bases (dressing, foliage, actors, terrain) register theirs as they mount.
 */

/** Three coincident points: a draw with no fragments. */
export const WARM_GEOMETRY = new THREE.BufferGeometry();
WARM_GEOMETRY.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));

export const meshTemplate = (material: THREE.Material): THREE.Mesh => new THREE.Mesh(WARM_GEOMETRY, material);

export const instancedTemplate = (material: THREE.Material, options: { instanceColor?: boolean } = {}): THREE.InstancedMesh => {
  const mesh = new THREE.InstancedMesh(WARM_GEOMETRY, material, 1);
  if (options.instanceColor) mesh.setColorAt(0, new THREE.Color());
  return mesh;
};

/** What a mesh adds to its material's program key (the material itself is the map key below). */
const programVariantOf = (mesh: THREE.Mesh): string => {
  const instanced = mesh as THREE.InstancedMesh;
  return [
    instanced.isInstancedMesh ? (instanced.instanceColor ? "instanced+color" : "instanced") : "mesh",
    (mesh as THREE.SkinnedMesh).isSkinnedMesh ? "skinned" : "",
    mesh.geometry?.morphAttributes?.position ? "morph" : "",
  ].join("");
};

const materialsOf = (mesh: THREE.Mesh): THREE.Material[] => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

/** Every (material, variant) a template has been queued for — what reportUnwarmedPrograms checks against. */
const warmedVariants = new WeakMap<THREE.Material, Set<string>>();
const reportedUnwarmed = new WeakMap<THREE.Material, Set<string>>();

/** DEV CHECK for a class base: every mesh `object` draws must have been warmed (same material, same
 *  Mesh/InstancedMesh/instanceColor variant), or its program links mid-play in the frame it first
 *  shows. Logs once per material + variant, naming what to add. Call it before the spawn fade swaps
 *  in its twin materials. */
export const reportUnwarmedPrograms = (object: THREE.Object3D, owner: string, fix: string): void => {
  if (process.env.NODE_ENV === "production") return;
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const variant = programVariantOf(mesh);
    for (const material of materialsOf(mesh)) {
      if (warmedVariants.get(material)?.has(variant)) continue;
      const reported = reportedUnwarmed.get(material) ?? new Set<string>();
      if (reported.has(variant)) continue;
      reported.add(variant);
      reportedUnwarmed.set(material, reported);
      console.error(
        `[warmPrograms] ${owner} draws a ${variant} with a ${material.type}${material.name ? ` "${material.name}"` : ""} ` +
          `that was never warmed, so its program links mid-play — ${fix}`,
      );
    }
  });
};

/** three r158+ `compileAsync`: links through KHR_parallel_shader_compile, so the links of every template
 *  queued in one load overlap on the driver's threads instead of blocking the main thread one by one
 *  inside the draw (measured: two terrain programs of ~1s each, the load's longest tasks). */
type AsyncCompiler = THREE.WebGLRenderer & {
  compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Object3D | null) => Promise<unknown>;
};

let compiler: { renderer: AsyncCompiler; camera: THREE.Camera; parallel: boolean } | null = null;

/** The canvas binds its renderer and camera once (CustomCanvas): templates are then compiled
 *  asynchronously before their warm draw. Unbound, on a three without compileAsync, or on a browser without
 *  KHR_parallel_shader_compile (Firefox), the warm draw links them itself, one template per frame: there
 *  compileAsync would link every queued program in ONE task (nothing runs off-thread without the extension),
 *  and three warns once that the extension is missing. Returns the unbind. */
export const bindProgramCompiler = (renderer: THREE.WebGLRenderer, camera: THREE.Camera): (() => void) => {
  // `has` probes without three's missing-extension warning (`get` warns).
  const parallel = renderer.extensions.has("KHR_parallel_shader_compile");
  const bound = { renderer: renderer as AsyncCompiler, camera, parallel };
  compiler = bound;
  return () => {
    if (compiler === bound) compiler = null;
  };
};

/** `onDone` runs once every mesh in `templates` has been drawn and the holder has left the scene. The
 *  returned cancel takes the holder out undrawn (call it on unmount: its assets are about to be disposed). */
export const warmPrograms = (scene: THREE.Object3D, templates: THREE.Object3D[], onDone?: () => void): (() => void) => {
  const holder = new THREE.Group();
  holder.scale.setScalar(0);
  const bound = compiler;
  const compilesAhead = !!bound?.parallel && bound.renderer.compileAsync !== undefined;
  // Linking inside the draw instead, the templates draw one per frame, so their links never stack
  // into one long task.
  const waiting: THREE.Object3D[] = [];
  let pending = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    scene.remove(holder);
    holder.clear();
    onDone?.();
  };
  const drawNext = () => {
    const next = waiting.shift();
    if (next && !finished) holder.add(next);
  };
  for (const template of templates) {
    let undrawn = 0;
    template.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (process.env.NODE_ENV !== "production") {
        const variant = programVariantOf(mesh);
        for (const material of materialsOf(mesh)) {
          const variants = warmedVariants.get(material) ?? new Set<string>();
          variants.add(variant);
          warmedVariants.set(material, variants);
        }
      }
      pending++;
      undrawn++;
      const wasCulled = mesh.frustumCulled;
      mesh.frustumCulled = false;
      const prev = mesh.onAfterRender;
      mesh.onAfterRender = function (this: THREE.Mesh, ...args: Parameters<THREE.Mesh["onAfterRender"]>) {
        mesh.onAfterRender = prev;
        mesh.frustumCulled = wasCulled;
        prev.apply(this, args);
        const templateDrawn = --undrawn === 0;
        // The render list is already built: leave the scene graph alone until the frame is done.
        if (--pending === 0) setTimeout(finish, 0);
        else if (templateDrawn && !compilesAhead) setTimeout(drawNext, 0);
      };
    });
    if (undrawn === 0) continue;
    if (compilesAhead) holder.add(template);
    else waiting.push(template);
  }
  if (pending === 0) {
    finish();
    return () => {};
  }
  if (bound && compilesAhead) {
    // Compiled OUTSIDE the scene under the scene's lights (`targetScene`: they key the program), then
    // drawn — by then its programs are linked and the draw only uploads.
    bound.renderer.compileAsync!(holder, bound.camera, scene).then(
      () => !finished && scene.add(holder),
      () => !finished && scene.add(holder),
    );
  } else {
    drawNext();
    scene.add(holder);
  }
  return finish;
};
