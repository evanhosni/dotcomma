/** Serialized cap on one blob; a patch that would exceed it is rejected on both sides. */
export const PLAYER_DATA_MAX_BYTES = 64 * 1024;

/** A tunnel toggle id: `manhole|<district>|<node>` or `door|<district>|<node>|<side>` (generation/underground/sewers/index.ts). */
export const TUNNEL_TOGGLE_ID = /^(manhole|door)|[-0-9,]{1,24}|[-0-9,]{1,24}(|[0-3])?$/;

/** Longest animation clip name a `move` may carry. */
export const MAX_CLIP_NAME_LENGTH = 32;
/** Fastest clip speed a `move` may carry. */
export const MAX_CLIP_SPEED = 10;
