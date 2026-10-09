# Save

## How it works

One save object, plain JSON, with the same shape (`SaveData`, [types.ts](types.ts)) in two stores:

- **Device** ([deviceSave.ts](deviceSave.ts)): localStorage key `dotcomma:save`. It is read synchronously at module load, so it is there at the first render. A corrupt blob or blocked storage starts empty and never throws.
- **Account** ([accountSave.ts](accountSave.ts)): the hosted db, which is the server-persisted player blob ([net/playerData.ts](../net/playerData.ts), keyed by the browser's identity). It arrives with the server's `init` after the socket opens.

[save.ts](save.ts) is the only entry point:
- `getSave()` / `useSave()` return the MERGED save: the account save under the device save. It re-merges when the account copy lands. Where both hold a field, the device wins; the merge is shallow, so the device's whole field replaces the account's.
- `saveToDevice(patch)` shallow-merges a patch into the device save and writes it.
- `saveToAccount(patch)` patches the account blob. Nothing calls it yet.

What lives where today:

| field | store | written by |
|---|---|---|
| `devmode` — `{ <flag>: boolean }` for every `DEV_TOGGLES` entry | device | [context/DevContext.tsx](../context/DevContext.tsx), on every checkbox change |

## How to add a saved field

1. Add it to `SaveData` ([types.ts](types.ts)), with a doc comment saying which store it belongs to.
2. Write it with `saveToDevice({ field })` (this device only), or with `saveToAccount({ field })` (follows the player; the server must also accept the key: `validatePatch` in [server/src/game/persistence.ts](../../server/src/game/persistence.ts)).
3. Read it with `useSave().field` in components or `getSave().field` elsewhere. Validate what you read: a save written by an older build, or edited by hand, can hold anything (see `togglesFromSave` in DevContext).
