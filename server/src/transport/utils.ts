import { isDomainId } from "../../../src/net/protocol/utils";
import { MAX_CLIP_NAME_LENGTH, MAX_CLIP_SPEED, PLAYER_DATA_MAX_BYTES, TUNNEL_TOGGLE_ID } from "../../../src/net/protocol/constants";
import type { ClientMessage, EntityRegisterItem, MoveIntent } from "../../../src/net/protocol/types";
import { MAX_ID_LENGTH, MAX_ENTITIES_PER_MESSAGE } from "./constants";

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

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
  const { x, y, z, vx, vy, vz, ry, hy, hp, clip, cs, loop } = raw;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  if (!isFiniteNumber(vx) || !isFiniteNumber(vy) || !isFiniteNumber(vz) || !isFiniteNumber(ry)) return null;
  if (!isFiniteNumber(hy) || !isFiniteNumber(hp) || !isFiniteNumber(cs) || cs < 0 || cs > MAX_CLIP_SPEED) return null;
  if (typeof clip !== "string" || clip.length === 0 || clip.length > MAX_CLIP_NAME_LENGTH) return null;
  if (loop !== "repeat" && loop !== "once") return null;
  return { x, y, z, vx, vy, vz, ry, hy, hp, clip, cs, loop };
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
    case "tunnel:toggle":
      return typeof raw.id === "string" && TUNNEL_TOGGLE_ID.test(raw.id) ? { t: "tunnel:toggle", id: raw.id } : null;
    default:
      return null;
  }
};
