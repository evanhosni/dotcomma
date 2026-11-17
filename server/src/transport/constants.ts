import type { PerMessageDeflateOptions } from "ws";

export const HEARTBEAT_MS = 30_000;
export const MAX_PAYLOAD_BYTES = 64 * 1024; // a 64-actor registration batch is ~6KB; headroom for state blobs
export const MAX_ENTITIES_PER_MESSAGE = 256;
export const MAX_ID_LENGTH = 128;

/** permessage-deflate, which every browser offers. A frame averages ~150 B, so every frame is compressed
 *  (threshold 0) and the deflate CONTEXT is kept across frames — consecutive snapshots repeat their keys
 *  and ids, which is most of the gain (no_context_takeover sent 79% of raw instead of 26%, at the same CPU). Window 15 /
 *  memLevel 8 is zlib's default: ~256 KB of deflate state per connection, and 26% of raw where window 12
 *  (~144 KB) sent 35%. client_max_window_bits is left to the client: requiring it would refuse a browser
 *  that does not offer it. MEASURED (a recorded stream of 40 walking beebles, ~70 frames per connection per
 *  tick, real tick rate): 55.6 → 14.7 KB/s per connection, for +1.8 ms of main-thread CPU (+2.9 ms in all)
 *  per connection per tick — each frame is its own deflate, threadpool round trip and socket write.
 *  WS_DEFLATE=off turns it off. */
export const PER_MESSAGE_DEFLATE: PerMessageDeflateOptions = {
  threshold: 0,
  serverMaxWindowBits: 15,
  zlibDeflateOptions: { memLevel: 8 },
};
