# Networking (client)

## How it works

The client keeps one WebSocket to the game server (the same origin that served the page). The server is the only authority: it relays player presence, persists player data and simulates every synced NPC. Nothing here uses React state per frame. Movement mutates module state, and React only sees UI-rate events (status, roster changes) through `useSyncExternalStore`.

| file | job |
|---|---|
| [protocol.ts](protocol.ts) | **The wire protocol.** It is the only copy; the server bundles this file. Every message type, `PlayerSnapshot`, `PlayerData`, `PLAYER_DATA_MAX_BYTES` and `playerDataBytes` (the one size measure both sides cap on). The header comment lists every message. Keep it Three-free. |
| [connection.ts](connection.ts) | The singleton socket, started in [index.tsx](../index.tsx). `getWebSocketUrl()` (override with `REACT_APP_WS_URL`), the persistent **identity** uuid in localStorage, `hello` → `init`, backoff reconnect, a 15s ping with a watchdog, the server-clock estimate `getServerTime()` (day/night and interpolation run on it), a domain relay on every domain switch, and closing the socket on `pagehide`. Subscribe with `onServerMessage(fn)`; send with `send(msg)`. |
| [playerData.ts](playerData.ts) | YOUR persisted blob: `getPlayerData()`, `usePlayerData()`, `updatePlayerData(patch)`. It merges optimistically and sends `data:patch`. The server's echo always wins, and it reaches every tab of the same identity. |
| [players/store.ts](players/store.ts) | The remote-player roster (join/move/leave), plus `useRosterVersion()` for React. |
| [players/RemotePlayers.tsx](players/RemotePlayers.tsx) | Draws other players as capsules. One `useFrame` extrapolates each player's last velocity and eases toward it. |
| [players/LocalPlayerSync.tsx](players/LocalPlayerSync.tsx) | Sends the local player's **intent changes** (velocity, yaw, stop, >0.75u drift), never per-frame positions. |
| [entities/entityStore.ts](entities/entityStore.ts) | Every synced actor this client renders: batched `entity:register` / `unregister`, merged `entity:update` fields, and a snapshot buffer per entity. |
| [entities/interpolation.ts](entities/interpolation.ts) | Pure snapshot interpolation. It draws an entity as it was `INTERP_DELAY_MS` (200ms) ago on the SERVER clock. It extrapolates at most 250ms, holds across idle gaps, and snaps on jumps over 40u. Unit-tested next to it. |
| [entities/posePlayback.ts](entities/posePlayback.ts) | A per-actor render clock that slews toward `serverTime − delay`, plus the sampler. |
| [entities/useSyncedEntity.ts](entities/useSyncedEntity.ts) | The `SyncHandle` the actor base creates (`ctx.sync`). It registers on mount, unregisters on unmount, and exposes `target`, `state`, `stateId`, `interact()`. |

**Two ids**: `identity` (localStorage) names the persisted player. `id` (per connection) names the session. Two tabs are two sessions of one identity.

**Scope**: every broadcast is per domain (a "room"). Switching domain means the client leaves the old room, joins the new one, and gets a fresh `init`.

The full NPC sync design (who simulates, interpolation, animation timing, input) is [NPC_TRACKING.md](../../NPC_TRACKING.md).

## How to use/add

### Sync an NPC

You write no networking code. Follow "Wiring a NEW NPC" in [NPC_TRACKING.md](../../NPC_TRACKING.md) §6: a state machine, a spec and one line in a biome spec's `actors`. Any actor is synced by default. Set `serverSynced: false` on its placement to run it locally.

### Store something per player

```ts
import { usePlayerData, updatePlayerData } from "../net/playerData";
const data = usePlayerData();                 // null until the first init
updatePlayerData({ lastVisited: "/desert" }); // false if not connected or over 64KB
```

The blob's shape is open. When you add a real key, name it in `PlayerData` ([protocol.ts](protocol.ts)) and validate it in `validatePatch` ([server/src/game/persistence.ts](../../server/src/game/persistence.ts)).

### Add a message type

1. In [protocol.ts](protocol.ts): add the interface with a new `t`, add it to `ClientMessage` or `ServerMessage`, and add a line to the header table.
2. Server: validate the frame in [server/src/transport/ws.ts](../../server/src/transport/ws.ts) and handle it in [server/src/game/world.ts](../../server/src/game/world.ts).
3. Client: `send({ t: "...", ... })`, and/or `onServerMessage((msg) => { if (msg.t === "...") ... })` in a module next to what it affects (see [playerData.ts](playerData.ts)).

### Debug

In the console: `__net` (connection), `__playerData.data` / `__playerData.update({...})`. The top-right HUD shows status and how many players are here ([menus/overlay/NetOverlay.tsx](../menus/overlay/NetOverlay.tsx)).
