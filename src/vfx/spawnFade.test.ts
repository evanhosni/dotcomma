import * as THREE from "three";
import { _spawnFade } from "./spawnFade";

const patched = (): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({ color: 0x336699 });
  _spawnFade.patchMaterial(material);
  return material;
};

const compileUniforms = (material: THREE.Material): Record<string, THREE.IUniform> => {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: "void main() {}", fragmentShader: "void main() {}" };
  material.onBeforeCompile(shader as any, null as any);
  return shader.uniforms;
};

describe("spawn fade", () => {
  const D = _spawnFade.DURATION;

  it("draws a fading object with twins that read through to the shared base and go back when done", () => {
    const base = patched();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), base);
    const root = new THREE.Group().add(mesh);
    const fade = new _spawnFade.SpawnFade(root);
    const t = 1000;
    fade.fadeIn(0, t);

    const twin = mesh.material as THREE.MeshStandardMaterial;
    expect(twin).not.toBe(base);
    expect(twin.id).not.toBe(base.id);
    expect(twin.customProgramCacheKey()).toBe(base.customProgramCacheKey());
    base.emissiveIntensity = 3;
    expect(twin.emissiveIntensity).toBe(3);
    expect(compileUniforms(base).uSpawnFade.value).toBe(1);

    expect(fade.update(t + D * 0.5)).toBeGreaterThan(0);
    expect(fade.update(t + D * 0.5)).toBeLessThan(1);
    expect(compileUniforms(twin).uSpawnFade.value).toBe(fade.value(t + D * 0.5));

    expect(fade.update(t + D + 0.1)).toBe(1);
    expect(mesh.material).toBe(base);
    expect(fade.fading).toBe(false);
  });

  it("shares one twin per material between objects that start together", () => {
    const base = patched();
    const a = new THREE.Mesh(new THREE.BoxGeometry(), base);
    const b = new THREE.Mesh(new THREE.BoxGeometry(), base);
    const fa = new _spawnFade.SpawnFade(a);
    const fb = new _spawnFade.SpawnFade(b);
    fa.fadeIn(0, 2000.001);
    fb.fadeIn(0, 2000.002);
    expect(a.material).toBe(b.material);
    fa.release();
    fb.release();
    expect(a.material).toBe(base);
  });

  it("fades out from where it is and holds at 0", () => {
    const base = patched();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), base);
    const fade = new _spawnFade.SpawnFade(mesh);
    fade.fadeIn(0, 3000);
    const mid = fade.update(3000 + D * 0.6);
    fade.fadeOut(3000 + D * 0.6);
    // Reversal quantizes the ramp start by ≤ 1/30 s: continuous to within one step.
    expect(Math.abs(fade.value(3000 + D * 0.6) - mid)).toBeLessThan(0.2);
    expect(fade.update(3000 + D * 3)).toBe(0);
    expect(fade.fading).toBe(true);
    expect(mesh.material).not.toBe(base);
    fade.release();
    expect(mesh.material).toBe(base);
  });

  it("shadows a ShaderMaterial's uniforms without copying the shared ones", () => {
    const shared = { value: 0.25 };
    const base = new THREE.ShaderMaterial({ uniforms: { uShared: shared }, vertexShader: "void main() {}", fragmentShader: "void main() {}" });
    _spawnFade.patchMaterial(base);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), base);
    const fade = new _spawnFade.SpawnFade(mesh);
    fade.fadeIn(0, 4000);
    const twin = mesh.material as THREE.ShaderMaterial;
    expect(twin.uniforms.uShared).toBe(shared);
    twin.onBeforeCompile({ uniforms: twin.uniforms, vertexShader: "void main() {}", fragmentShader: "void main() {}" } as any, null as any);
    expect(twin.uniforms.uSpawnFade).not.toBe(base.uniforms.uSpawnFade);
    fade.release();
  });
});
