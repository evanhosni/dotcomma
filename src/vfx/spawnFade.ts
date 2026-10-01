import * as THREE from "three";
import { SCREEN_DOOR_GLSL } from "./dither";

/**
 * SPAWN FADE (CLAUDE.md → vfx/spawnFade.ts): every game object dithers in when it appears
 * and — where its class fades out — dithers out the same way. A SCREEN-DOOR fade (discard
 * against a 4×4 Bayer threshold), never alpha: no transparency sorting, depth writes kept,
 * one branch per fragment, identical for opaque, instanced and skinned materials.
 *
 * The value is PER OBJECT but materials are SHARED (one exterior material for every building,
 * one per dressing feature across all chunks), and three uploads a material's uniforms only
 * when the material changes between draws — so a per-object uniform on a shared material is
 * impossible. Instead a fading object draws with TWINS: `Object.create(base)` views of its
 * materials with their own id and their own `uSpawnFade`. Everything else reads through to
 * the base (a lamp's per-frame emissive, a global uniform), the program cache key is the
 * base's (same program — no new variants), and the object goes back to the base materials
 * the moment its fade completes.
 *
 * Objects that start fading in the same TRACK_QUANTUM share a RAMP and its twins, so a spawn
 * batch or a ring of dressing chunks draws with one twin per material — at most
 * 2 × DURATION / TRACK_QUANTUM twins per material ever exist, and a burst still batches.
 *
 * Applied from the class bases only: prepareActorMaterial, prepareDressingMaterial, the
 * foliage shader. Visual only — colliders, raycasts and placement never see it.
 */
export namespace _spawnFade {
  /** Seconds for a full fade in or out. */
  export const DURATION = 0.5;
  /** Ramps starting within one quantum share their twins (a fade starts ≤ 1/30s late). */
  const TRACK_QUANTUM = 1 / 30;

  export const clock = (): number => performance.now() / 1000;

  /** The fade's ease (smoothstep); linearOf is its inverse. */
  const ease = (t: number): number => t * t * (3 - 2 * t);

  /** Base materials draw fully visible; only twins ever carry another value. */
  const VISIBLE: THREE.IUniform<number> = { value: 1 };

  /** Fragment-side test for a visibility expression. Bayer thresholds are (k + 0.5)/16, so 1 never discards and 0 always does. */
  export const discardGLSL = (visibility: string): string =>
    `if (${visibility} < 1.0 && ${visibility} <= screenDoorThreshold(gl_FragCoord.xy)) discard;`;

  const FRAGMENT_HEADER = /* glsl */ `
    uniform float uSpawnFade;
    ${SCREEN_DOOR_GLSL}
  `;

  /**
   * Idempotent, chains onBeforeCompile. `perInstance`: the visibility is ALSO multiplied by an
   * `aSpawnFade` instanced attribute — for one mesh holding many independently spawned objects
   * (the far building doors). It is a different program, so only such meshes use it.
   */
  export const patchMaterial = (material: THREE.Material, options: { perInstance?: boolean } = {}): void => {
    if ((material as any).__spawnFadePatched) return;
    (material as any).__spawnFadePatched = true;
    const perInstance = !!options.perInstance;

    const originalCacheKey = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => (originalCacheKey?.() ?? "") + (perInstance ? "_spawnFadeInst" : "_spawnFade");

    const prevOnBeforeCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prevOnBeforeCompile?.call(material, shader, renderer);
      shader.uniforms.uSpawnFade = VISIBLE;
      const visibility = perInstance ? "(uSpawnFade * vSpawnFade)" : "uSpawnFade";
      if (perInstance) {
        shader.vertexShader = shader.vertexShader.replace(
          "void main() {",
          "attribute float aSpawnFade;\nvarying float vSpawnFade;\nvoid main() {\n  vSpawnFade = aSpawnFade;",
        );
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        "void main() {",
        FRAGMENT_HEADER + (perInstance ? "varying float vSpawnFade;\n" : "") + "void main() {\n  " + discardGLSL(visibility),
      );
    };

    material.addEventListener("dispose", onBaseDispose);
    material.needsUpdate = true;
  };

  // ─── twins ────────────────────────────────────────────────────────────────

  interface Twin extends THREE.Material {
    __spawnFadeBase: THREE.Material;
    __spawnFadeUniform: THREE.IUniform<number>;
  }

  const freeTwins = new WeakMap<THREE.Material, Twin[]>();
  const disposedBases = new WeakSet<THREE.Material>();
  // Past every id three's own counter will reach: a twin must never share an id with a real material,
  // or the renderer skips its uniform upload.
  let nextTwinId = 1e9;

  function onBaseDispose(this: THREE.Material): void {
    disposedBases.add(this);
    const pool = freeTwins.get(this);
    if (pool) for (const twin of pool) twin.dispose();
    freeTwins.delete(this);
  }

  const createTwin = (base: THREE.Material): Twin => {
    const twin = Object.create(base) as Twin;
    Object.defineProperty(twin, "id", { value: nextTwinId++ });
    twin.uuid = THREE.MathUtils.generateUUID();
    // Own listener map: the inherited one would register (and unregister) the renderer's
    // dispose hook on the BASE.
    (twin as any)._listeners = {};
    twin.__spawnFadeBase = base;
    const uniform: THREE.IUniform<number> = { value: 0 };
    twin.__spawnFadeUniform = uniform;
    if ((base as THREE.ShaderMaterial).isShaderMaterial) {
      // A ShaderMaterial's program uniforms ARE material.uniforms: shadow them, sharing every entry.
      (twin as unknown as THREE.ShaderMaterial).uniforms = Object.create((base as THREE.ShaderMaterial).uniforms);
    }
    twin.onBeforeCompile = (shader, renderer) => {
      base.onBeforeCompile.call(base, shader, renderer);
      shader.uniforms.uSpawnFade = uniform;
    };
    return twin;
  };

  const acquireTwin = (base: THREE.Material): Twin => freeTwins.get(base)?.pop() ?? createTwin(base);

  const releaseTwin = (twin: Twin): void => {
    const base = twin.__spawnFadeBase;
    if (disposedBases.has(base)) {
      twin.dispose();
      return;
    }
    let pool = freeTwins.get(base);
    if (!pool) freeTwins.set(base, (pool = []));
    pool.push(twin);
  };

  // ─── ramps ────────────────────────────────────────────────────────────────

  /** A linear 0→1 (dir 1) or 1→0 (dir −1) ramp from t0, eased, shared by every object on it. */
  class Ramp {
    users = 0;
    readonly twins = new Map<THREE.Material, Twin>();
    private value = -1;
    constructor(readonly key: string, readonly dir: 1 | -1, readonly t0: number) {}

    linearAt(now: number): number {
      const t = Math.min(1, Math.max(0, (now - this.t0) / DURATION));
      return this.dir > 0 ? t : 1 - t;
    }

    /** Eased visibility now; writes it to every twin on the ramp. */
    update(now: number): number {
      const v = ease(this.linearAt(now));
      if (v !== this.value) {
        this.value = v;
        this.twins.forEach((twin) => (twin.__spawnFadeUniform.value = v));
      }
      return v;
    }

    finished(now: number): boolean {
      return now - this.t0 >= DURATION;
    }

    twinFor(base: THREE.Material): Twin {
      let twin = this.twins.get(base);
      if (!twin) {
        twin = acquireTwin(base);
        twin.__spawnFadeUniform.value = Math.max(0, this.value);
        this.twins.set(base, twin);
      }
      return twin;
    }
  }

  const ramps = new Map<string, Ramp>();

  const acquireRamp = (dir: 1 | -1, t0: number): Ramp => {
    // Ceil: a quantized ramp only ever starts LATER, so a fade in never opens above 0.
    const q = Math.ceil(t0 / TRACK_QUANTUM);
    const key = `${dir}:${q}`;
    let ramp = ramps.get(key);
    if (!ramp) ramps.set(key, (ramp = new Ramp(key, dir, q * TRACK_QUANTUM)));
    ramp.users++;
    return ramp;
  };

  const releaseRamp = (ramp: Ramp): void => {
    if (--ramp.users > 0) return;
    ramps.delete(ramp.key);
    ramp.twins.forEach(releaseTwin);
    ramp.twins.clear();
  };

  const baseOf = (material: THREE.Material): THREE.Material | null => {
    const base = (material as Partial<Twin>).__spawnFadeBase;
    if (base) return base;
    return (material as any).__spawnFadePatched ? material : null;
  };

  // ─── per object ───────────────────────────────────────────────────────────

  /**
   * One object's fade — an actor's group, a dressing chunk. Drive it once per frame with
   * update() while `fading`; everything under `root` that went through its class base's
   * material prep follows, including meshes that mount mid-fade.
   */
  export class SpawnFade {
    private ramp: Ramp | null = null;
    private readonly swapped = new Set<THREE.Mesh>();

    constructor(private root: THREE.Object3D | null = null) {}

    setRoot(root: THREE.Object3D | null): void {
      if (root === this.root) return;
      this.restore();
      this.root = root;
    }

    /** True while the object is drawn with a ramp (fading, or held at 0 after a fade out). */
    get fading(): boolean {
      return this.ramp !== null;
    }

    /** Visibility now, without advancing anything. */
    value(now = clock()): number {
      if (!this.ramp) return 1;
      return ease(this.ramp.linearAt(now));
    }

    /** Toward visible, from `from` (default: wherever it is now). */
    fadeIn(from?: number, now = clock()): void {
      const lin = linearOf(from ?? this.value(now));
      if (lin >= 1) {
        this.release();
        return;
      }
      this.switchRamp(acquireRamp(1, now - lin * DURATION));
    }

    /** Toward hidden, from wherever it is now. Holds at 0 until release(). */
    fadeOut(now = clock()): void {
      const lin = linearOf(this.value(now));
      this.switchRamp(acquireRamp(-1, now - (1 - lin) * DURATION));
    }

    /** Per frame while fading: visibility now. A finished fade IN hands the object back to its base materials. */
    update(now = clock()): number {
      const ramp = this.ramp;
      if (!ramp) return 1;
      const v = ramp.update(now);
      if (ramp.dir > 0 && ramp.finished(now)) {
        this.release();
        return 1;
      }
      this.bind(ramp);
      return v;
    }

    /** Back to the base materials, no ramp: fully visible. */
    release(): void {
      this.restore();
      if (this.ramp) releaseRamp(this.ramp);
      this.ramp = null;
    }

    private switchRamp(next: Ramp): void {
      if (this.ramp) releaseRamp(this.ramp);
      this.ramp = next;
      next.update(clock());
      this.bind(next);
    }

    /** Re-walked every frame of a fade: a mesh can mount mid-fade (a building's doors). */
    private bind(ramp: Ramp): void {
      this.root?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        if (Array.isArray(mesh.material)) {
          const current = mesh.material;
          const stale = current.some((m) => {
            const base = baseOf(m);
            return base !== null && ramp.twinFor(base) !== m;
          });
          if (stale) {
            mesh.material = current.map((m) => {
              const base = baseOf(m);
              return base ? ramp.twinFor(base) : m;
            });
            this.swapped.add(mesh);
          }
          return;
        }
        const base = baseOf(mesh.material);
        if (!base) return;
        const twin = ramp.twinFor(base);
        if (twin !== mesh.material) {
          mesh.material = twin;
          this.swapped.add(mesh);
        }
      });
    }

    private restore(): void {
      this.swapped.forEach((mesh) => {
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => (m as Partial<Twin>).__spawnFadeBase ?? m);
        } else {
          const base = (mesh.material as Partial<Twin>).__spawnFadeBase;
          if (base) mesh.material = base;
        }
      });
      this.swapped.clear();
    }
  }

  /** Objects that fade in when they appear and never fade out — dressing chunks, foliage chunks. */
  export class SpawnFadeSet {
    private readonly fades = new Map<THREE.Object3D, SpawnFade>();

    /** Call as the object is added to the scene: it is bound at once, so its first draw is already hidden. */
    add(object: THREE.Object3D): void {
      this.delete(object);
      const fade = new SpawnFade(object);
      fade.fadeIn(0);
      this.fades.set(object, fade);
    }

    delete(object: THREE.Object3D): void {
      const fade = this.fades.get(object);
      if (!fade) return;
      fade.release();
      this.fades.delete(object);
    }

    /** Every frame; a no-op once nothing is fading. */
    update(now = clock()): void {
      if (this.fades.size === 0) return;
      this.fades.forEach((fade, object) => {
        fade.update(now);
        if (!fade.fading) this.fades.delete(object);
      });
    }

    clear(): void {
      this.fades.forEach((fade) => fade.release());
      this.fades.clear();
    }
  }

  /** Inverse of the ease, so a reversed fade continues from the visibility on screen. */
  const linearOf = (v: number): number => {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    // smoothstep⁻¹: t = 0.5 − sin(asin(1 − 2v) / 3)
    return 0.5 - Math.sin(Math.asin(1 - 2 * v) / 3);
  };
}
