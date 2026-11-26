import { useEffect, useState } from "react";
import { getConnectionState } from "../../../../net";
import { onPlayerDied } from "../../../../net/players/store";
import { getLocalPlayerBody, setPlayerHeld } from "../../../../player/store";
import type { PointXZ } from "../../../../utils/math/types";
import { resetEquipment } from "../../../../equippables/store";
import { DEATH_HOLD_SECONDS } from "./constants";
import { IntroRun } from "./IntroRun";

/**
 * The way in, and back in (README.md): one IntroRun when the overworld boots, and a fresh one, a RESCAN from
 * over the spot, each time the local player's host dies. The dying body is hidden at once (its corpse falls
 * in its place, player/corpses/) and the player held, the view on the fall, for DEATH_HOLD_SECONDS.
 */
export const Intro = () => {
  const [run, setRun] = useState<{ key: number; rescanAt: PointXZ | null }>({ key: 0, rescanAt: null });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = onPlayerDied((id) => {
      const body = getLocalPlayerBody();
      if (id !== getConnectionState().selfId || !body) return;
      setPlayerHeld(true);
      body.visible = false;
      body.equipped = "";
      resetEquipment();
      const at = { x: body.feetX, z: body.feetZ };
      clearTimeout(timer);
      timer = setTimeout(() => setRun((r) => ({ key: r.key + 1, rescanAt: at })), DEATH_HOLD_SECONDS * 1000);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  return <IntroRun key={run.key} rescanAt={run.rescanAt} />;
};
