import * as THREE from "three";
import type { CutPlane, ShotHit, Wound, WoundHole } from "../net/protocol/types";
import { MAX_SHOT_HITS, MAX_WOUNDS_PER_SHOT } from "../objects/actors/wounds/constants";
import { MAX_CUT_PLANES } from "../objects/actors/slices/constants";
import type { ShotTarget } from "./types";
import { BODY_TEST_RADIUS, EXIT_WOUND_SCALE, MAX_BODY_DEPTH, SWING_ARC_COS } from "./constants";

interface SurfaceHit {
  distance: number;
  point: THREE.Vector3;
  /** The hit triangle's face normal, in the world (either way round: holeAt turns it outward). */
  normal: THREE.Vector3;
  mesh: THREE.SkinnedMesh;
  /** The hit triangle's vertex nearest the point: its skin is the hole's. */
  vertex: number;
}

const _inverse = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _against = new THREE.Vector3();

const _blend = new THREE.Matrix4();
const _part = new THREE.Matrix4();

/** Every surface of the meshes the ray crosses within `far`, nearest first. Triangle by triangle on the posed
 *  vertices, both faces (an exit is a back face), as rayHitDistance (model/geometry.ts) picks. */
const surfacesHit = (ray: THREE.Ray, meshes: readonly THREE.SkinnedMesh[], far: number): SurfaceHit[] => {
  const hits: SurfaceHit[] = [];
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const index = geometry.index;
    if (!index || !mesh.skeleton) continue;
    _inverse.copy(mesh.matrixWorld).invert();
    _localRay.copy(ray).applyMatrix4(_inverse);
    for (let i = 0; i < index.count; i += 3) {
      const ia = index.getX(i);
      const ib = index.getX(i + 1);
      const ic = index.getX(i + 2);
      mesh.getVertexPosition(ia, _a);
      mesh.getVertexPosition(ib, _b);
      mesh.getVertexPosition(ic, _c);
      if (!_localRay.intersectTriangle(_a, _b, _c, false, _hit)) continue;
      const da = _hit.distanceToSquared(_a);
      const db = _hit.distanceToSquared(_b);
      const dc = _hit.distanceToSquared(_c);
      const vertex = da <= db && da <= dc ? ia : db <= dc ? ib : ic;
      const point = _hit.clone().applyMatrix4(mesh.matrixWorld);
      const distance = ray.origin.distanceTo(point);
      const normal = _b.sub(_a).cross(_c.sub(_a)).transformDirection(mesh.matrixWorld).clone();
      if (distance <= far) hits.push({ distance, point, normal, mesh, vertex });
    }
  }
  return hits.sort((p, q) => p.distance - q.distance);
};

/** A hole where `hit` is, skinned by its vertex's bones: the point and the skin's normal taken back to the
 *  bind pose through their weighted blend (the skinning the surface itself is drawn with,
 *  objects/actors/wounds/WoundSet.ts). `outward`: the way out of the body there (against the bullet at an
 *  entry, along it at an exit). */
const holeAt = (hit: SurfaceHit, radius: number, outward: THREE.Vector3): WoundHole => {
  const { mesh, vertex } = hit;
  const index = mesh.geometry.getAttribute("skinIndex");
  const weight = mesh.geometry.getAttribute("skinWeight");
  const b: string[] = [];
  const w: number[] = [];
  _blend.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  for (let c = 0; c < 4; c++) {
    const share = weight.getComponent(vertex, c);
    const bone = mesh.skeleton.bones[index.getComponent(vertex, c)];
    if (share <= 0 || !bone) continue;
    b.push(bone.name);
    w.push(share);
    _part.multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[index.getComponent(vertex, c)]);
    for (let e = 0; e < 16; e++) _blend.elements[e] += _part.elements[e] * share;
  }
  _inverse.copy(_blend).invert();
  const bind = _a.copy(hit.point).applyMatrix4(_inverse);
  const normal = _b.copy(hit.normal);
  if (normal.dot(outward) < 0) normal.negate();
  normal.transformDirection(_inverse);
  return { b, w, x: bind.x, y: bind.y, z: bind.z, nx: normal.x, ny: normal.y, nz: normal.z, r: radius };
};

/** The wounds a bullet leaves in one body whose surfaces it crosses (`hits`, nearest first): those within
 *  MAX_BODY_DEPTH of the first, paired into channels, in and out (of an arm, then of the chest),
 *  MAX_WOUNDS_PER_SHOT at most; a last surface with no pair is a bullet that stayed in. */
const woundsOf = (ray: THREE.Ray, hits: SurfaceHit[], woundRadius: number): Wound[] => {
  _against.copy(ray.direction).negate();
  const crossed = hits.filter((h) => h.distance - hits[0].distance <= MAX_BODY_DEPTH).slice(0, MAX_WOUNDS_PER_SHOT * 2);
  const wounds: Wound[] = [];
  for (let i = 0; i < crossed.length; i += 2) {
    const exit = crossed[i + 1];
    wounds.push({ entry: holeAt(crossed[i], woundRadius, _against), exit: exit ? holeAt(exit, woundRadius * EXIT_WOUND_SCALE, ray.direction) : null });
  }
  return wounds;
};

/**
 * Every body a shot along `ray` goes through within `far` (the world's first solid surface, or the weapon's
 * range: bodies never stop a bullet), nearest first, MAX_SHOT_HITS at most, each with the wounds it leaves
 * there. Empty for a miss.
 */
export const shotHitsOf = (ray: THREE.Ray, far: number, targets: Iterable<ShotTarget>, woundRadius: number): ShotHit[] => {
  const struck: { target: ShotTarget; hits: SurfaceHit[] }[] = [];
  for (const target of targets) {
    ray.closestPointToPoint(target.origin, _closest);
    if (_closest.distanceToSquared(target.origin) > BODY_TEST_RADIUS * BODY_TEST_RADIUS) continue;
    if (ray.origin.distanceTo(target.origin) > far + BODY_TEST_RADIUS) continue;
    const hits = surfacesHit(ray, target.meshes, far);
    if (hits.length > 0) struck.push({ target, hits });
  }
  return struck
    .sort((p, q) => p.hits[0].distance - q.hits[0].distance)
    .slice(0, MAX_SHOT_HITS)
    .map(({ target, hits }) => ({ kind: target.kind, id: target.id, at: [hits[0].point.x, hits[0].point.y, hits[0].point.z], wounds: woundsOf(ray, hits, woundRadius) }));
};

const _p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _q = new THREE.Vector3();
const _to = new THREE.Vector3();
const _bind = new THREE.Matrix4();
const _planePoint = new THREE.Vector3();
const _planeNormal = new THREE.Vector3();

/**
 * Every body a blade's swing cuts: the plane through `eye` with unit `normal` (across the swing, at right
 * angles to the look) crossing the body's posed triangles in front of the eye within `reach` and the swing's
 * arc. Each body's cut names every bone of every crossed triangle, with the swing's plane carried into the
 * bind space as that bone has it now (net/protocol/types.ts Cut), so every client cuts the same body the same
 * way. `at` is the crossing nearest the crosshair (the blood). Nearest first.
 */
export const sliceHitsOf = (eye: THREE.Vector3, look: THREE.Vector3, normal: THREE.Vector3, reach: number, targets: Iterable<ShotTarget>): ShotHit[] => {
  const hits: { hit: ShotHit; distance: number }[] = [];
  const ray = new THREE.Ray(eye, look);
  for (const target of targets) {
    if (target.origin.distanceTo(eye) > reach + BODY_TEST_RADIUS) continue;
    const bones = new Set<number>();
    let skeleton: THREE.Skeleton | null = null;
    let best = Infinity;
    const at = new THREE.Vector3();
    for (const mesh of target.meshes) {
      const index = mesh.geometry.index;
      const skinIndex = mesh.geometry.getAttribute("skinIndex");
      const skinWeight = mesh.geometry.getAttribute("skinWeight");
      if (!index || !mesh.skeleton || !skinIndex || !skinWeight) continue;
      skeleton = mesh.skeleton;
      for (let i = 0; i < index.count; i += 3) {
        const corners = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        const side = corners.map((v, k) => normal.dot(_to.subVectors(mesh.getVertexPosition(v, _p[k]).applyMatrix4(mesh.matrixWorld), eye)));
        if ((side[0] > 0) === (side[1] > 0) && (side[1] > 0) === (side[2] > 0)) continue;
        let crossed = false;
        for (let k = 0; k < 3; k++) {
          const a = k;
          const b = (k + 1) % 3;
          if ((side[a] > 0) === (side[b] > 0)) continue;
          _q.lerpVectors(_p[a], _p[b], side[a] / (side[a] - side[b]));
          _to.subVectors(_q, eye);
          const distance = _to.length();
          if (distance > reach || _to.dot(look) < distance * SWING_ARC_COS) continue;
          crossed = true;
          const off = ray.distanceSqToPoint(_q);
          if (off < best) {
            best = off;
            at.copy(_q);
          }
        }
        if (!crossed) continue;
        for (const v of corners) for (let c = 0; c < 4; c++) if (skinWeight.getComponent(v, c) > 0) bones.add(skinIndex.getComponent(v, c));
      }
    }
    if (!skeleton || bones.size === 0) continue;
    const planes: CutPlane[] = [];
    for (const b of [...bones].slice(0, MAX_CUT_PLANES)) {
      // World → the bind space as this bone carries it now (bone · bind⁻¹, inverted).
      _bind.multiplyMatrices(skeleton.bones[b].matrixWorld, skeleton.boneInverses[b]).invert();
      _planePoint.copy(eye).applyMatrix4(_bind);
      _planeNormal.copy(normal).transformDirection(_bind);
      planes.push({ b: skeleton.bones[b].name, nx: _planeNormal.x, ny: _planeNormal.y, nz: _planeNormal.z, d: _planeNormal.dot(_planePoint) });
    }
    hits.push({ hit: { kind: target.kind, id: target.id, at: [at.x, at.y, at.z], wounds: [], cuts: [{ p: planes }] }, distance: at.distanceTo(eye) });
  }
  return hits.sort((p, q) => p.distance - q.distance).slice(0, MAX_SHOT_HITS).map((h) => h.hit);
};

/** Every body within `radius` of a blast at `center` (its origin: the cheap test), nearest first: each bursts. */
export const blastHitsOf = (center: THREE.Vector3, radius: number, targets: Iterable<ShotTarget>): ShotHit[] =>
  [...targets]
    .map((target) => ({ target, distance: target.origin.distanceTo(center) }))
    .filter(({ distance }) => distance <= radius)
    .sort((p, q) => p.distance - q.distance)
    .slice(0, MAX_SHOT_HITS)
    .map(({ target: t }) => ({ kind: t.kind, id: t.id, at: [t.origin.x, t.origin.y, t.origin.z], wounds: [], gib: true }));