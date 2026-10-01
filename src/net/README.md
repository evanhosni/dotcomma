# Networking (client)

## How it works

One WebSocket to the game server, which is the only authority (presence, player data, NPC simulation). Movement mutates module state; React sees only UI-rate changes.

- [protocol.ts](protocol.ts): the wire protocol, the only copy (the server bundles it) — `ClientMessage`, `ServerMessage`, `PlayerSnapshot`, `PlayerData`, `PLAYER_DATA_MAX_BYTES`, `playerDataBytes`. Keep it Three-free.
- [connection.ts](connection.ts): the singleton socket — `getWebSocketUrl()`, the persistent identity, reconnect, ping watchdog, `getServerTime()`, domain relay, close on `pagehide`. API: `send(msg)`, `onServerMessage(fn)`.
- [playerData.ts](playerData.ts): your persisted blob — `getPlayerData()`, `usePlayerData()`, `updatePlayerData(patch)`; optimistic, the server's echo wins.
- [players/](players/): remote roster ([store.ts](players/store.ts), `useRosterVersion()`), capsules ([RemotePlayers.tsx](players/RemotePlayers.tsx)), and [LocalPlayerSync.tsx](players/LocalPlayerSync.tsx), which sends intent changes, never per-frame positions.
- [entities/](entities/): synced actors — [entityStore.ts](entities/entityStore.ts) (register/update/snapshots), [interpolation.ts](entities/interpolation.ts) (draws each entity `INTERP_DELAY_MS` behind on the server clock), [posePlayback.ts](entities/posePlayback.ts) (per-actor render clock), [useSyncedEntity.ts](entities/useSyncedEntity.ts) (the `SyncHandle` the actor base uses).
- Two ids: `identity` (persisted, shared by tabs) and `id` (one per session). Broadcasts are scoped to one room per domain.

## How to add another

- **Synced NPC**: no networking code — follow "Wiring a NEW NPC" in [NPC_TRACKING.md](../../NPC_TRACKING.md).
- **Per-player data key**: name it in `PlayerData` ([protocol.ts](protocol.ts)) and validate it in `validatePatch` ([server/src/game/persistence.ts](../../server/src/game/persistence.ts)); write with `updatePlayerData`.
- **Message type**:
  1. [protocol.ts](protocol.ts): add the interface with a new `t`, add it to `ClientMessage` or `ServerMessage`, list it in the header.
  2. Server: validate in [server/src/transport/ws.ts](../../server/src/transport/ws.ts), handle in [server/src/game/world.ts](../../server/src/game/world.ts).
  3. Client: `send(...)` and/or `onServerMessage(...)` in a module next to what it affects (see [playerData.ts](playerData.ts)).
