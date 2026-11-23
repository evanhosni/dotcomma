import { advance } from "@react-three/fiber";
import { useEffect } from "react";
import { setBackgroundTick } from "../../vfx/store";
import { startTicking } from "./worker";

/** Under the player's MAX_STEP_SECONDS (50ms) with room for timer jitter: a tick longer than that clamp
 *  would lose the excess, and the world would fall behind real time. */
const TICK_MS = 33;
/** rAF silent this long = the browser stopped it (hidden tab, minimized window). */
const RAF_STALE_MS = 200;

/** Keeps the frame loop running when the browser stops requestAnimationFrame, so a hidden tab's player
 *  (and everything else on useFrame) goes on in real time and other clients never see it frozen mid-air.
 *  The background ticks run every useFrame but present nothing. */
export const BackgroundLoop = () => {
  useEffect(() => {
    let lastRafAt = performance.now();
    let raf = 0;
    const markRaf = () => {
      lastRafAt = performance.now();
      raf = requestAnimationFrame(markRaf);
    };
    raf = requestAnimationFrame(markRaf);

    const stop = startTicking(TICK_MS, () => {
      const now = performance.now();
      if (now - lastRafAt < RAF_STALE_MS) return;
      setBackgroundTick(true);
      try {
        advance(now);
      } finally {
        setBackgroundTick(false);
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      stop();
    };
  }, []);
  return null;
};
