/** Serialized cap on one blob; a patch that would exceed it is rejected on both sides. */
export const PLAYER_DATA_MAX_BYTES = 64 * 1024;

/** A tunnel toggle id: `manhole|<district>|<node>` or `door|<district>|<node>|<side>` (generation/underground/sewers/index.ts). */
export const TUNNEL_TOGGLE_ID = /^(manhole|door)|[-0-9,]{1,24}|[-0-9,]{1,24}(|[0-3])?$/;
