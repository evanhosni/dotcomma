/** The night blend at `timeMs` into the repeating day → dusk → night → dawn cycle (0 = full day, 1 = full night). */
export const nightBlendAt = (timeMs: number, dayMs: number, nightMs: number, transitionMs: number): number => {
  const t = timeMs % (dayMs + transitionMs + nightMs + transitionMs);
  if (t < dayMs) return 0;
  if (t < dayMs + transitionMs) return (t - dayMs) / transitionMs;
  if (t < dayMs + transitionMs + nightMs) return 1;
  return 1 - (t - dayMs - transitionMs - nightMs) / transitionMs;
};
