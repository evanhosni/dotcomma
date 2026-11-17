import type { DomainConfig } from "./types";

/** The DomainConfig the pipeline was last initialized with (initCompute); null before the first
 *  init. Every pipeline module reads it through this live binding. */
export let domainConfig: DomainConfig | null = null;

export const setDomainConfig = (config: DomainConfig): void => {
  domainConfig = config;
};
