import { useEffect, useRef, useState } from "react";
import { getLocalHealth, getLocalPlayerBody, isPlayerHeld, onLocalHealth } from "../../player/store";
import { PLAYER_HEALTH } from "../../player/spec";
import { HUD_Z_INDEX, PANEL_STYLE } from "./constants";

/** How often it checks whether the player is a beeble at play (ms): a UI cadence, never per frame. */
const SHOWN_POLL_MS = 250;
const HURT_FLASH_MS = 350;
const HURT_COLOR = "rgba(150,0,8,0.45)";

const PANEL: React.CSSProperties = { ...PANEL_STYLE, position: "fixed", left: 12, bottom: 12, zIndex: HUD_Z_INDEX };
const FLASH: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
  zIndex: HUD_Z_INDEX - 1,
  boxShadow: `inset 0 0 160px 60px ${HURT_COLOR}`,
};
/** At a hit the edge shows at once, then fades. */
const FADE = `opacity ${HURT_FLASH_MS}ms ease-out`;
/** Long enough for the browser to paint the edge before its fade starts. */
const FLASH_HOLD_MS = 30;

const BAR_CELLS = 10;

/** The host's health (bottom-left, the HUD's look) while the player is a beeble at play, and a red edge
 *  around the screen at each hit. */
export const HealthOverlay = () => {
  const [health, setHealth] = useState(getLocalHealth);
  const [shown, setShown] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  const [flashing, setFlashing] = useState(false);

  useEffect(
    () =>
      onLocalHealth((next, hurt) => {
        setHealth(next);
        if (!hurt) return;
        setFlashing(true);
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashing(false), FLASH_HOLD_MS);
      }),
    [],
  );
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  useEffect(() => {
    const poll = setInterval(() => setShown(getLocalPlayerBody()?.form === "host" && !isPlayerHeld()), SHOWN_POLL_MS);
    return () => clearInterval(poll);
  }, []);

  const filled = Math.ceil((Math.max(health, 0) / PLAYER_HEALTH) * BAR_CELLS);
  return (
    <>
      <div style={{ ...FLASH, opacity: flashing ? 1 : 0, transition: flashing ? "none" : FADE }} />
      {shown && <div style={PANEL}>{`health ${"█".repeat(filled)}${"░".repeat(BAR_CELLS - filled)} ${Math.max(0, Math.round(health))}`}</div>}
    </>
  );
};
