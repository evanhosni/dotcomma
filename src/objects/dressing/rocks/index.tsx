import { traceSpan } from "../../../utils/spikeTrace";
import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL } from "../../../lighting/dayNight";
import { _material } from "../../../utils/material";
import { uploadOnFirstDraw } from "../../../utils/uploadOnFirstDraw";
import { meshTemplate } from "../../../utils/warmPrograms";
import type { RockPoint } from "../../../utils/workers/vertexCompute";
import { ditherGLSL } from "../../../vfx/dither";
import { CHUNK_PROJECTION_GLSL, CHUNK_PROJECTION_UNIFORMS } from "../../../world/shaders/chunkProjection";
import commonShader from "../../../world/shaders/common.glsl";
import { glslFloat, TERRAIN_TEXTURE_TILE, WORLD_WRAP } from "../../../world/shaders/constants";
import { selfPatchedMaterial, type SolidDressingProps, useChunkAssets, useSolidDressing } from "..";
import type { ChunkBounds } from "../types";
import { ROCK_COLLIDER_DISTANCE, ROCK_RENDER_DISTANCE, ROCK_SHADE_DARK, ROCK_SHADE_LIGHT, ROCKS_SPEC } from "./spec";
import { ROCK_SHAPES } from "./shapes";
import { declare } from "../../../world/content";
import { featureMounts } from "../../../utils/workers/biomeFlags";
import { ROCK_DEFAULTS, ROCKS } from "../../../utils/workers/rocks/params";
import type { RockParams } from "../../../utils/workers/types";
import { farthest } from "../utils";

/**
 * ROCKS: one merged, flat-shaded mesh per chunk (every lump baked in place, its shade as a vertex
 * attribute, rebased on the chunk's middle) in the mountain wall's rock look under the terrain's own
 * light, with snow on the up-facing faces of a rock whose biome has snow (none on a waterfall boulder: its
 * `snow` is 0); a trimesh collider per lump near the player, built by the
 * same spec on the server (rockSpec.ts).
 */

/** The mountain wall's texture (the mountain biome's `rocktexture`), triplanar on the wrapped position. */
const ROCK_TEXTURE = "dirt.png";

const createRockMaterial = (): THREE.ShaderMaterial => {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...CHUNK_PROJECTION_UNIFORMS,
      rocktexture: { value: null as THREE.Texture | null },
      uShadeDark: { value: new THREE.Color(ROCK_SHADE_DARK) },
      uShadeLight: { value: new THREE.Color(ROCK_SHADE_LIGHT) },
      uNightBlend: NIGHT_BLEND_UNIFORM,
    },
    defines: { WORLD_WRAP: glslFloat(WORLD_WRAP), TEXTURE_TILE: glslFloat(TERRAIN_TEXTURE_TILE) },
    vertexShader: /* glsl */ `
      attribute float shade;
      attribute float snow;
      varying float vShade;
      varying float vSnow;
      ${CHUNK_PROJECTION_GLSL}
      void main() {
        vShade = shade;
        vSnow = snow;
        gl_Position = projectChunkLocal(position, normal);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D rocktexture;
      uniform vec3 uShadeDark;
      uniform vec3 uShadeLight;
      uniform float uNightBlend;
      varying float vShade;
      varying float vSnow;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosWrapped;
      ${commonShader}
      void main() {
        vec3 n = normalize(vWorldNormal);
        // The mountain wall's rock: the terrain's texture, triplanar on the wrapped world position, tinted.
        vec3 rock = triplanarSample(rocktexture, vWorldPosWrapped, n, 1.0 / TEXTURE_TILE).rgb * vec3(0.62, 0.62, 0.66);
        // Each rock a little lighter or darker than the wall: its shade over the middle of the shade range.
        rock *= mix(uShadeDark, uShadeLight, vShade) / mix(uShadeDark, uShadeLight, 0.5);
        // Snow on the up-facing faces of a rock whose biome has snow; none on a boulder in a waterfall.
        vec3 col = mix(rock, vec3(0.9, 0.93, 0.97), smoothstep(0.55, 0.8, n.y) * vSnow);
        col *= 0.6 + 0.4 * fakeSunLight(n);
        ${nightDimGLSL("col")}
        ${ditherGLSL("col")}
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  _material
    .loadTextures([ROCK_TEXTURE])
    .then(([texture]) => {
      material.uniforms.rocktexture.value = texture;
    })
    .catch((e) => console.error("rock texture failed to load:", e));
  return material;
};

const _euler = new THREE.Euler();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Every rock of the chunk baked into one flat-shaded geometry relative to the chunk's middle. */
const buildRockMesh = (rocks: RockPoint[], bounds: ChunkBounds, material: THREE.Material): THREE.Mesh => {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  let triangles = 0;
  for (const r of rocks) triangles += ROCK_SHAPES[r.variant].indices.length / 3;
  const positions = new Float32Array(triangles * 9);
  const normals = new Float32Array(triangles * 9);
  const shades = new Float32Array(triangles * 3);
  const snows = new Float32Array(triangles * 3);
  let o = 0;
  for (const r of rocks) {
    const shape = ROCK_SHAPES[r.variant];
    _m.makeRotationFromEuler(_euler.set(0, r.yaw, r.pitch));
    const p = shape.positions;
    const idx = shape.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const base = o;
      for (let k = 0; k < 3; k++) {
        const i = idx[t + k] * 3;
        _v.set(p[i] * r.sx, p[i + 1] * r.sy, p[i + 2] * r.sz).applyMatrix4(_m);
        positions[o * 3] = _v.x + r.x - cx;
        positions[o * 3 + 1] = _v.y + r.y;
        positions[o * 3 + 2] = _v.z + r.z - cz;
        shades[o] = r.shade;
        snows[o] = r.snow;
        o++;
      }
      const ax = positions[base * 3], ay = positions[base * 3 + 1], az = positions[base * 3 + 2];
      const bx = positions[base * 3 + 3], by = positions[base * 3 + 4], bz = positions[base * 3 + 5];
      const cxx = positions[base * 3 + 6], cy = positions[base * 3 + 7], czz = positions[base * 3 + 8];
      _n.set((by - ay) * (czz - az) - (bz - az) * (cy - ay), (bz - az) * (cxx - ax) - (bx - ax) * (czz - az), (bx - ax) * (cy - ay) - (by - ay) * (cxx - ax)).normalize();
      for (let k = 0; k < 3; k++) {
        normals[(base + k) * 3] = _n.x;
        normals[(base + k) * 3 + 1] = _n.y;
        normals[(base + k) * 3 + 2] = _n.z;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("shade", new THREE.BufferAttribute(shades, 1));
  geometry.setAttribute("snow", new THREE.BufferAttribute(snows, 1));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(cx, 0, cz);
  mesh.userData.ownsGeometry = true;
  uploadOnFirstDraw(mesh);
  return mesh;
};

export interface RocksProps extends SolidDressingProps, Partial<RockParams> {}

/** ROCKS strewn over the biome this is mounted in, by slope: steeper ground keeps more. Every
 *  mount is one density field of its own (its props over ROCK_DEFAULTS), and this one driver draws
 *  them all — chunks are world-space, so a driver per mount would build each one twice. */
export const Rocks = declare<RocksProps>({
  kind: ROCKS,
  within: "biome",
  read: (node) => ({ ...ROCK_DEFAULTS, ...node.props }),
  Driver: () => <RocksDriver />,
});

const RocksDriver = () => {
  const mounts = featureMounts<RocksProps>(ROCKS);
  const renderDistance = farthest(mounts, "renderDistance", ROCK_RENDER_DISTANCE);
  const colliderDistance = farthest(mounts, "colliderDistance", ROCK_COLLIDER_DISTANCE);
  const assets = useChunkAssets(
    () => ({ rock: selfPatchedMaterial(createRockMaterial()) }),
    (a) => [meshTemplate(a.rock.material)],
  );
  const { content } = useSolidDressing(ROCKS_SPEC, {
    renderDistance,
    colliderDistance,
    build: (rocks, _bodies, bounds) =>
      traceSpan("rocks:chunk", () => {
        const group = new THREE.Group();
        group.add(buildRockMesh(rocks, bounds, assets.rock.material));
        return { group };
      }),
  });
  return content;
};
