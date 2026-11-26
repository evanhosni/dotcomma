# Networking (client)

## How it works

One WebSocket to the game server, which is the only authority (presence, player data, NPC simulation). Movement mutates module state; React sees only UI-rate changes.

- [protocol/](protocol): the wire protocol, the only copy (the server bundles it) — [types.ts](protocol/types.ts) (`ClientMessage`, `ServerMessage`, `PlayerSnapshot`, `PlayerData`, and the message list in its header), [enums.ts](protocol/enums.ts) (`DOMAIN_IDS`), [constants.ts](protocol/constants.ts) (`PLAYER_DATA_MAX_BYTES`, `TUNNEL_TOGGLE_ID`), [utils.ts](protocol/utils.ts) (`playerDataBytes`, `isDomainId`). Keep it Three-free.
- [index.ts](index.ts): the singleton socket — `getWebSocketUrl()`, the persistent identity, reconnect, ping watchdog, `getServerTime()`, domain relay, close on `pagehide`. API: `send(msg)`, `onServerMessage(fn)`.
- [store.ts](store.ts): your persisted blob — `getPlayerData()`, `usePlayerData()`, `updatePlayerData(patch)`; optimistic, the server's echo wins.
- [players/](players): remote roster ([store.ts](players/store.ts), `useRosterVersion()`), beebles ([RemotePlayers.tsx](players/RemotePlayers.tsx): each player a server-stamped snapshot track played back by the entities' `PosePlayback`, [entities/utils.ts](entities/utils.ts), drawn by the local player's own [PlayerBody](../player/PlayerBody.tsx); each move also carries the drawn pose (`PlayerAvatar`: clip, clip speed, loop, head yaw and pitch; `ry` is the body's facing), shown when the same delayed clock reaches that move; each has the NPC beeble's collider, a kinematic capsule in the local Rapier world, and is clickable as an NPC is: the crosshair ray hitting its drawn MESH within an NPC's reach (the NPCs' triangle test, `rayHitDistance` in objects/actors/model/geometry.ts) claims the hover, and a click sends `player:click`, which the server relays to that player alone, whose client logs "you were clicked"), and [LocalPlayerSync.tsx](players/LocalPlayerSync.tsx), which sends every `PUBLISH_INTERVAL_MS` while moving and at once on a start/stop/turn/relocation or a change of the drawn pose, nothing while standing still.
- [entities/](entities): synced actors — [store.ts](entities/store.ts) (register/update/snapshots), [utils.ts](entities/utils.ts) (the interpolation: draws each entity `INTERP_DELAY_MS` behind on the server clock), [posePlayback.ts](entities/posePlayback.ts) (per-actor render clock), [hooks.ts](entities/hooks.ts) (`useSyncedEntity`, the `SyncHandle` the actor base uses), [constants.ts](entities/constants.ts) (`PUBLISH_INTERVAL_MS`, `INTERP_DELAY_MS`).
- Two ids: `identity` (persisted, shared by tabs) and `id` (one per session). Broadcasts are scoped to one room per domain.

- **Forms and hosts** (the overworld intro, world/domains/overworld/intro/): every `move` carries the player's form (`fm`: `"mav"`, its MAV Unit alone, whose origin the position then is, or `"host"`, a beeble wearing it) and, while the unit screws into an NPC, that NPC's id and how far in (`mh`, `md`). The possession itself is the `host` message, step by step: `claim` (answered `host:claim` ok or not: one claimer per NPC), `impact` (the server ragdolls it), `wake` (stands it up, held), `possess` (retires it: `host:taken` to the room, and `init.hostsTaken` lists them for anyone joining later; [net/entities/store.ts](entities/store.ts) retires them locally), `release`. Only the claimer's steps count; a session that leaves lets its claim go.
- **Tunnel toggles** (manhole covers, sewer doors): the SERVER's state per domain. A click sends `tunnel:toggle` (id shape `TUNNEL_TOGGLE_ID`); the server flips it and sends `tunnel:state` to the whole room; `init.tunnelsOpen` carries the open set. world/underground/store.ts mirrors it; the server's NPCs fall down the same open manholes (server/src/game/world.ts `toggleTunnel`, physicsWorld `setTunnelOpen`).

## How to add another

- **Synced NPC**: no networking code — follow "Wiring a NEW NPC" in [NPC_TRACKING.md](../../NPC_TRACKING.md).
- **Per-player data key**: name it in `PlayerData` ([protocol/types.ts](protocol/types.ts)) and validate it in `validatePatch` ([server/src/game/utils.ts](../../server/src/game/utils.ts)); write with `updatePlayerData`.
- **Message type**:
  1. [protocol/types.ts](protocol/types.ts): add the interface with a new `t`, add it to `ClientMessage` or `ServerMessage`, list it in the header.
  2. Server: validate in [server/src/transport/index.ts](../../server/src/transport/index.ts), handle in [server/src/game/world.ts](../../server/src/game/world.ts).
  3. Client: `send(...)` and/or `onServerMessage(...)` in a module next to what it affects (see [store.ts](store.ts)).
