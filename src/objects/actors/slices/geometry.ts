import * as THREE from "three";
import type { Cut, CutPlane } from "../../../net/protocol/types";
import { WELD_PRECISION } from "./constants";
import type { SliceInput, SliceResult, Stump } from "./types";

/** The four skin influences a vertex keeps. */
const SKIN = 4;
/** A vertex exactly on a plane counts as in front of it: every edge crossing is decided one way. */
const ON_PLANE = 1e-9;

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

const component = (attribute: Attribute, i: number, c: number): number =>
  c === 0 ? attribute.getX(i) : c === 1 ? attribute.getY(i) : c === 2 ? attribute.getZ(i) : attribute.getW(i);

/** An attribute's values as plain numbers (denormalized), growable. */
const readChannel = (attribute: Attribute): number[] => {
  const out: number[] = new Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i++) for (let c = 0; c < attribute.itemSize; c++) out[i * attribute.itemSize + c] = component(attribute, i, c);
  return out;
};

/** The first weld of a mesh: one id per distinct position, so its seams (a vertex split for its uv or
 *  normal) hold the surface together. */
export const weldOf = (geometry: THREE.BufferGeometry): Int32Array => {
  const position = geometry.getAttribute("position");
  const ids = new Int32Array(position.count);
  const seen = new Map<string, number>();
  const q = (v: number) => Math.round(v / WELD_PRECISION);
  for (let i = 0; i < position.count; i++) {
    const key = `${q(position.getX(i))},${q(position.getY(i))},${q(position.getZ(i))}`;
    let id = seen.get(key);
    if (id === undefined) seen.set(key, (id = seen.size));
    ids[i] = id;
  }
  return ids;
};

/** The planes of a cut, by bone name ("*": every bone). */
const planesOf = (cut: Cut): Map<string, CutPlane> => new Map(cut.p.map((p) => [p.b, p]));

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _inverseBind = new THREE.Matrix4();

/**
 * One cut through one skinned mesh, in its BIND space (so every client cuts the same body the same way,
 * whatever pose its copy lies in). Each vertex is measured against the plane of its heaviest bone the cut
 * names (or the "*" plane); a vertex the cut does not name, sharing a triangle with one it does, borrows that
 * one's plane, so the cut never stops one triangle short. Every triangle crossing its plane is split along it
 * and each side gets its OWN copies of the new vertices (welded apart: the sides part), every skin weight
 * blended. Each side's cut edge is capped with flesh: a fan from its loop's middle. Then the surface falls
 * into PIECES: what the cut crossed, connected through the welds. Null when the cut crosses nothing here.
 */
export const sliceMesh = (input: SliceInput, cut: Cut, welds: { next: number }): SliceResult | null => {
  const { geometry, bindMatrix, boneNames } = input;
  const index = geometry.index;
  const position = geometry.getAttribute("position");
  const skinIndexAttribute = geometry.getAttribute("skinIndex");
  const skinWeightAttribute = geometry.getAttribute("skinWeight");
  if (!index || !position || !skinIndexAttribute || !skinWeightAttribute) return null;
  const count = position.count;
  const planes = planesOf(cut);
  const every = planes.get("*");

  const skinIndex = readChannel(skinIndexAttribute);
  const skinWeight = readChannel(skinWeightAttribute);

  // The plane each vertex is measured against.
  const planeOf: (CutPlane | undefined)[] = new Array(count);
  for (let v = 0; v < count; v++) {
    if (every) {
      planeOf[v] = every;
      continue;
    }
    let best = 0;
    for (let c = 0; c < SKIN; c++) {
      const w = skinWeight[v * SKIN + c];
      const plane = w > best ? planes.get(boneNames[skinIndex[v * SKIN + c]]) : undefined;
      if (plane) {
        best = w;
        planeOf[v] = plane;
      }
    }
  }
  const borrowed: (CutPlane | undefined)[] = new Array(count);
  for (let i = 0; i < index.count; i += 3) {
    const corners = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const named = corners.find((v) => planeOf[v]);
    if (named === undefined) continue;
    for (const v of corners) if (!planeOf[v] && !borrowed[v]) borrowed[v] = planeOf[named];
  }
  const side = new Float64Array(count);
  for (let v = 0; v < count; v++) {
    const plane = (planeOf[v] ??= borrowed[v]);
    if (!plane) {
      side[v] = NaN;
      continue;
    }
    _v.fromBufferAttribute(position, v).applyMatrix4(bindMatrix);
    const s = plane.nx * _v.x + plane.ny * _v.y + plane.nz * _v.z - plane.d;
    side[v] = s === 0 ? ON_PLANE : s;
  }

  // Every other attribute (and morph target) blends along the cut like the position.
  const channels: { name: string; itemSize: number; data: number[]; morph?: { key: string; target: number } }[] = [];
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (name === "skinIndex" || name === "skinWeight") continue;
    channels.push({ name, itemSize: attribute.itemSize, data: readChannel(attribute) });
  }
  for (const [key, targets] of Object.entries(geometry.morphAttributes)) {
    targets.forEach((attribute, target) => channels.push({ name: key, itemSize: attribute.itemSize, data: readChannel(attribute), morph: { key, target } }));
  }
  const normal = channels.find((c) => c.name === "normal" && !c.morph);
  const weld = Array.from(input.weld);
  let vertexCount = count;

  /** A new vertex: the blend of `sources` by `shares` (summing to 1), skin weights merged, best four kept. */
  const mix = (sources: number[], shares: number[]): number => {
    for (const channel of channels) {
      const { itemSize, data } = channel;
      for (let c = 0; c < itemSize; c++) {
        let value = 0;
        for (let s = 0; s < sources.length; s++) value += data[sources[s] * itemSize + c] * shares[s];
        data.push(value);
      }
      if (channel === normal) {
        const o = data.length - 3;
        const length = Math.hypot(data[o], data[o + 1], data[o + 2]) || 1;
        for (let c = 0; c < 3; c++) data[o + c] /= length;
      }
    }
    const blend = new Map<number, number>();
    for (let s = 0; s < sources.length; s++) {
      for (let c = 0; c < SKIN; c++) {
        const w = skinWeight[sources[s] * SKIN + c] * shares[s];
        if (w > 0) blend.set(skinIndex[sources[s] * SKIN + c], (blend.get(skinIndex[sources[s] * SKIN + c]) ?? 0) + w);
      }
    }
    const kept = [...blend.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, SKIN);
    const total = kept.reduce((sum, [, w]) => sum + w, 0) || 1;
    for (let c = 0; c < SKIN; c++) {
      skinIndex.push(kept[c]?.[0] ?? 0);
      skinWeight.push((kept[c]?.[1] ?? 0) / total);
    }
    weld.push(-1);
    return vertexCount++;
  };

  const setNormal = (v: number, n: THREE.Vector3): void => {
    if (!normal) return;
    normal.data[v * 3] = n.x;
    normal.data[v * 3 + 1] = n.y;
    normal.data[v * 3 + 2] = n.z;
  };

  /** Each side's copy of the point where edge a–b crosses the cut, and the plane it crossed. */
  const edgeVertices = new Map<string, [number, number]>();
  const sideWelds = new Map<string, number>();
  const crossedPlane = new Map<number, CutPlane>();
  const weldFor = (key: string): number => {
    let id = sideWelds.get(key);
    if (id === undefined) sideWelds.set(key, (id = welds.next++));
    return id;
  };
  const edgeVertex = (p: number, q: number): [number, number] => {
    const a = Math.min(p, q);
    const b = Math.max(p, q);
    const key = `${a},${b}`;
    let pair = edgeVertices.get(key);
    if (pair) return pair;
    const t = side[a] / (side[a] - side[b]);
    pair = [mix([a, b], [1 - t, t]), mix([a, b], [1 - t, t])];
    const wa = Math.min(input.weld[a], input.weld[b]);
    const wb = Math.max(input.weld[a], input.weld[b]);
    weld[pair[0]] = weldFor(`+${wa},${wb}`);
    weld[pair[1]] = weldFor(`-${wa},${wb}`);
    crossedPlane.set(pair[0], planeOf[a]!);
    crossedPlane.set(pair[1], planeOf[a]!);
    edgeVertices.set(key, pair);
    return pair;
  };

  const fleshStart = (geometry.userData.fleshStart as number | undefined) ?? index.count;
  const skin: number[] = [];
  const flesh: number[] = [];
  /** The cut's edges on each side ([+, −]): pairs of vertices. */
  const seams: [number[], number[]] = [[], []];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    const out = i >= fleshStart ? flesh : skin;
    const pa = side[a] > 0;
    const pb = side[b] > 0;
    const pc = side[c] > 0;
    if (Number.isNaN(side[a] + side[b] + side[c]) || (pa === pb && pb === pc)) {
      out.push(a, b, c);
      continue;
    }
    // The lone corner first, the winding kept.
    const [l, r1, r2] = pa === pb ? [c, a, b] : pa === pc ? [b, c, a] : [a, b, c];
    const lone = side[l] > 0 ? 0 : 1;
    const other = 1 - lone;
    const e1 = edgeVertex(l, r1);
    const e2 = edgeVertex(l, r2);
    out.push(l, e1[lone], e2[lone]);
    out.push(e1[other], r1, r2, e1[other], r2, e2[other]);
    seams[lone].push(e1[lone], e2[lone]);
    seams[other].push(e1[other], e2[other]);
  }
  if (edgeVertices.size === 0) return null;

  // Caps: each side's seam falls into loops (connected through the welds); each loop is a fan of flesh
  // from its middle, its vertices copied with the cap's normal, out of the piece it closes.
  _inverseBind.copy(bindMatrix).invert();
  const stumps: Stump[] = [];
  seams.forEach((seam, s) => {
    const root = new Map<number, number>();
    const find = (w: number): number => {
      let r = w;
      while (root.has(r) && root.get(r) !== r) r = root.get(r)!;
      return r;
    };
    for (let i = 0; i < seam.length; i += 2) {
      const ra = find(weld[seam[i]]);
      const rb = find(weld[seam[i + 1]]);
      if (!root.has(ra)) root.set(ra, ra);
      if (ra !== rb) root.set(rb, ra);
    }
    const loops = new Map<number, number[]>();
    for (let i = 0; i < seam.length; i += 2) {
      const r = find(weld[seam[i]]);
      let loop = loops.get(r);
      if (!loop) loops.set(r, (loop = []));
      loop.push(i);
    }
    for (const segments of loops.values()) {
      const ends = [...new Set(segments.flatMap((i) => [seam[i], seam[i + 1]]))];
      _n.set(0, 0, 0);
      for (const v of ends) {
        const p = crossedPlane.get(v)!;
        _n.x += p.nx;
        _n.y += p.ny;
        _n.z += p.nz;
      }
      // The + side lies in front of its plane: its cap faces back along the normal.
      if (s === 0) _n.negate();
      const capNormal = _n.transformDirection(_inverseBind).clone();
      const middle = mix(ends, ends.map(() => 1 / ends.length));
      weld[middle] = weld[ends[0]];
      setNormal(middle, capNormal);
      const copies = new Map<number, number>();
      for (const v of ends) {
        const copy = mix([v], [1]);
        weld[copy] = weld[v];
        setNormal(copy, capNormal);
        copies.set(v, copy);
      }
      for (const i of segments) flesh.push(middle, copies.get(seam[i])!, copies.get(seam[i + 1])!);
      stumps.push({ vertex: middle, normal: capNormal });
    }
  });

  // Pieces: the cut's own parts, the surface connected through the welds.
  const parent = new Int32Array(welds.next).map((_, i) => i);
  const find = (w: number): number => {
    while (parent[w] !== w) w = parent[w] = parent[parent[w]];
    return w;
  };
  const triangles = [...skin, ...flesh];
  for (let i = 0; i < triangles.length; i += 3) {
    const r = find(weld[triangles[i]]);
    parent[find(weld[triangles[i + 1]])] = r;
    parent[find(weld[triangles[i + 2]])] = find(r);
  }
  const touched = new Set<number>();
  for (let v = count; v < vertexCount; v++) touched.add(find(weld[v]));
  const piece = new Int32Array(vertexCount).fill(-1);
  const pieceOfRoot = new Map<number, number>();
  for (let v = 0; v < vertexCount; v++) {
    const r = find(weld[v]);
    if (!touched.has(r)) continue;
    let p = pieceOfRoot.get(r);
    if (p === undefined) pieceOfRoot.set(r, (p = pieceOfRoot.size));
    piece[v] = p;
  }

  const out = new THREE.BufferGeometry();
  for (const channel of channels) {
    const attribute = new THREE.Float32BufferAttribute(channel.data, channel.itemSize);
    if (!channel.morph) out.setAttribute(channel.name, attribute);
    else (out.morphAttributes[channel.morph.key] ??= [])[channel.morph.target] = attribute;
  }
  out.morphTargetsRelative = geometry.morphTargetsRelative;
  out.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, SKIN));
  out.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, SKIN));
  out.setIndex(triangles);
  out.addGroup(0, skin.length, 0);
  out.addGroup(skin.length, flesh.length, 1);
  out.userData.fleshStart = skin.length;
  out.computeBoundingSphere();
  return { geometry: out, weld: Int32Array.from(weld), piece, pieceCount: pieceOfRoot.size, stumps };
};
