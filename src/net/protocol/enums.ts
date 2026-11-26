/** THE domain id list (world/domains/types.ts re-exports the type). */
export const DOMAIN_IDS = ["overworld", "404"] as const;

/** The intro's possession, step by step (HostMessage): THE list the server validates against. */
export const HOST_STEPS = ["claim", "impact", "wake", "possess", "release"] as const;
