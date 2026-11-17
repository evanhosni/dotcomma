/** Fetches around the camera when it has moved more than `travel` from the last successful fetch (or
 *  never fetched), one fetch at a time; a failed fetch retries on the next update. */
export interface TravelRefetch {
  update(x: number, z: number): void;
  /** Where the last successful fetch was centered; null before the first. */
  readonly fetchedAt: { x: number; z: number } | null;
  /** Forgets the last fetch and drops the one in flight (a domain reset: its worker may never answer), so
   *  the next update fetches. */
  reset(): void;
}
