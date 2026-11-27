import { isDomainId } from "../../../src/net/protocol/utils";
import { MAX_CLIP_NAME_LENGTH, MAX_CLIP_SPEED, PLAYER_DATA_MAX_BYTES, TUNNEL_TOGGLE_ID } from "../../../src/net/protocol/constants";
import { HOST_STEPS } from "../../../src/net/protocol/enums";
import type { ClientMessage, Cut, CutPlane, EntityRegisterItem, HostStep, MoveIntent, ShotHit, ShotImpact, Vec3Tuple, Wound, WoundHole } from "../../../src/net/protocol/types";
import { MAX_SHOT_HITS, MAX_WOUNDS_PER_SHOT } from "../../../src/objects/actors/wounds/constants";
import { MAX_CUT_PLANES } from "../../../src/objects/actors/slices/constants";
import { MAX_ID_LENGTH, MAX_ENTITIES_PER_MESSAGE } from "./constants";

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isHostStep = (v: unknown): v is HostStep => typeof v === "string" && (HOST_STEPS as readonly string[]).includes(v);

const parseRegisterItems = (raw: unknown): EntityRegisterItem[] | null => {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ENTITIES_PER_MESSAGE) return null;
  const out: EntityRegisterItem[] = [];
  for (const it of raw) {
    if (typeof it !== "object" || it === null) return null;
    const { id, kind, x, y, z } = it as Record<string, unknown>;
    if (!isId(id) || !isId(kind) || !isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
    out.push({ id, kind, x, y, z });
  }
  return out;
};

const parseMove = (raw: Record<string, unknown>): MoveIntent | null => {
  const { x, y, z, vx, vy, vz, ry, hy, hp, clip, cs, loop, fm, mh, md, wp } = raw;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  if (!isFiniteNumber(vx) || !isFiniteNumber(vy) || !isFiniteNumber(vz) || !isFiniteNumber(ry)) return null;
  if (!isFiniteNumber(hy) || !isFiniteNumber(hp) || !isFiniteNumber(cs) || cs < 0 || cs > MAX_CLIP_SPEED) return null;
  if (typeof clip !== "string" || clip.length === 0 || clip.length > MAX_CLIP_NAME_LENGTH) return null;
  if (loop !== "repeat" && loop !== "once") return null;
  if (fm !== "mav" && fm !== "host") return null;
  if (typeof mh !== "string" || mh.length > MAX_ID_LENGTH || !isFiniteNumber(md) || md < 0 || md > 1) return null;
  if (typeof wp !== "string" || wp.length > MAX_ID_LENGTH) return null;
  return { x, y, z, vx, vy, vz, ry, hy, hp, clip, cs, loop, fm, mh, md, wp };
};

const parseVec3 = (v: unknown): Vec3Tuple | null =>
  Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber) ? [v[0], v[1], v[2]] : null;

/** Bones a vertex is skinned to, at most. */
const MAX_SKIN_BONES = 4;

const parseHole = (raw: unknown): WoundHole | null => {
  if (!isPlainObject(raw)) return null;
  const { b, w, x, y, z, nx, ny, nz, r } = raw;
  if (!Array.isArray(b) || !Array.isArray(w) || b.length === 0 || b.length > MAX_SKIN_BONES || w.length !== b.length) return null;
  if (!b.every(isId) || !w.every((v) => isFiniteNumber(v) && v >= 0 && v <= 1)) return null;
  if (![x, y, z, nx, ny, nz].every(isFiniteNumber) || !isFiniteNumber(r) || r <= 0 || r > 1) return null;
  return { b, w, x: x as number, y: y as number, z: z as number, nx: nx as number, ny: ny as number, nz: nz as number, r };
};

const parseWounds = (raw: unknown): Wound[] | null => {
  if (!Array.isArray(raw) || raw.length > MAX_WOUNDS_PER_SHOT) return null;
  const out: Wound[] = [];
  for (const w of raw) {
    if (!isPlainObject(w)) return null;
    const entry = parseHole(w.entry);
    const exit = w.exit === null ? null : parseHole(w.exit);
    if (!entry || (w.exit !== null && !exit)) return null;
    out.push({ entry, exit });
  }
  return out;
};

const isUnit = (v: Vec3Tuple): boolean => Math.abs(Math.hypot(...v) - 1) <= 0.01;

const parseCutPlane = (raw: unknown): CutPlane | null => {
  if (!isPlainObject(raw)) return null;
  const { b, nx, ny, nz, d } = raw;
  if (!isId(b) || ![nx, ny, nz, d].every(isFiniteNumber) || !isUnit([nx as number, ny as number, nz as number])) return null;
  return { b, nx: nx as number, ny: ny as number, nz: nz as number, d: d as number };
};

/** A hit's slices: one blade's swing cuts a body once. undefined: malformed. */
const parseCuts = (raw: unknown): Cut[] | null | undefined => {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length > 1) return undefined;
  const out: Cut[] = [];
  for (const cut of raw) {
    if (!isPlainObject(cut) || !Array.isArray(cut.p) || cut.p.length === 0 || cut.p.length > MAX_CUT_PLANES) return undefined;
    const planes = cut.p.map(parseCutPlane);
    if (!planes.every((p): p is CutPlane => p !== null)) return undefined;
    out.push({ p: planes });
  }
  return out;
};

const parseShotHit = (raw: unknown): ShotHit | null => {
  if (!isPlainObject(raw)) return null;
  const at = parseVec3(raw.at);
  const wounds = parseWounds(raw.wounds);
  const cuts = parseCuts(raw.cuts);
  if ((raw.kind !== "npc" && raw.kind !== "player" && raw.kind !== "corpse") || !isId(raw.id) || !at || !wounds || cuts === undefined) return null;
  if (raw.gib !== undefined && raw.gib !== true) return null;
  const hit: ShotHit = { kind: raw.kind, id: raw.id, at, wounds };
  if (cuts && cuts.length > 0) hit.cuts = cuts;
  if (raw.gib) hit.gib = true;
  return hit;
};

const parseShotHits = (raw: unknown): ShotHit[] | null => {
  if (!Array.isArray(raw) || raw.length > MAX_SHOT_HITS) return null;
  const hits = raw.map(parseShotHit);
  return hits.every((h): h is ShotHit => h !== null) ? hits : null;
};

/** undefined: malformed. */
const parseImpact = (raw: unknown): ShotImpact | null | undefined => {
  if (raw === null) return null;
  if (!isPlainObject(raw)) return undefined;
  const at = parseVec3(raw.at);
  const n = parseVec3(raw.n);
  return at && n && isUnit(n) ? { at, n } : undefined;
};

/** Anything odd → null → ignored. */
export const parseClientMessage = (data: unknown): ClientMessage | null => {
  if (typeof data !== "object" || data === null) return null;
  const raw = data as Record<string, unknown>;
  switch (raw.t) {
    case "hello":
      if (typeof raw.identity !== "string" || raw.identity.length === 0 || raw.identity.length > 64) return null;
      if (!isDomainId(raw.domain)) return null;
      return { t: "hello", identity: raw.identity, domain: raw.domain };
    case "move": {
      const m = parseMove(raw);
      return m ? { t: "move", ...m } : null;
    }
    case "domain":
      return isDomainId(raw.domain) ? { t: "domain", domain: raw.domain } : null;
    case "ping":
      return isFiniteNumber(raw.t0) ? { t: "ping", t0: raw.t0 } : null;
    case "data:patch": {
      const patch = raw.patch;
      if (!isPlainObject(patch) || JSON.stringify(patch).length > PLAYER_DATA_MAX_BYTES) return null;
      return { t: "data:patch", patch };
    }
    case "entity:register": {
      const entities = parseRegisterItems(raw.entities);
      return entities ? { t: "entity:register", entities } : null;
    }
    case "entity:unregister": {
      const ids = raw.ids;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ENTITIES_PER_MESSAGE || !ids.every(isId)) return null;
      return { t: "entity:unregister", ids: ids as string[] };
    }
    case "entity:interact":
      return isId(raw.id) && isId(raw.action) ? { t: "entity:interact", id: raw.id, action: raw.action } : null;
    case "player:click":
      return isId(raw.id) ? { t: "player:click", id: raw.id } : null;
    case "host":
      return isId(raw.id) && isHostStep(raw.step) ? { t: "host", id: raw.id, step: raw.step } : null;
    case "shoot": {
      const o = parseVec3(raw.o);
      const d = parseVec3(raw.d);
      const hits = parseShotHits(raw.hits);
      const end = parseImpact(raw.end);
      if (!isId(raw.weapon) || !o || !d || !hits || end === undefined || !isUnit(d)) return null;
      return { t: "shoot", weapon: raw.weapon, o, d, hits, end };
    }
    case "tunnel:toggle":
      return typeof raw.id === "string" && TUNNEL_TOGGLE_ID.test(raw.id) ? { t: "tunnel:toggle", id: raw.id } : null;
    default:
      return null;
  }
};
