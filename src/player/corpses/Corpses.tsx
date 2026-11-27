import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import { getConnectionState } from "../../net";
import { getRemotePlayers, onPlayerDied } from "../../net/players/store";
import { CORPSE_SECONDS } from "../../objects/actors/wounds/constants";
import { playerBodyModel } from "../registry";
import { getLocalPlayerBody } from "../store";
import { Corpse } from "./Corpse";
import type { CorpseOrder, CorpseStep } from "./types";

/**
 * Every dead player's host (net/protocol PlayerDiedMessage), the local player's included: its body is hidden
 * (RemotePlayers.tsx; the intro's rescan for the local one) and a corpse lies in its place for CORPSE_SECONDS,
 * as a dead NPC lies. Mounted once, inside the physics world; ONE frame loop steps every corpse.
 */
export const Corpses = () => {
  const [orders, setOrders] = useState<CorpseOrder[]>([]);
  const steps = useRef(new Set<CorpseStep>()).current;

  useEffect(
    () =>
      onPlayerDied(({ id, d: dir, corpse, cuts, gib }) => {
        const body = id === getConnectionState().selfId ? getLocalPlayerBody() : getRemotePlayers().get(id)?.body;
        const from = body && playerBodyModel(body);
        if (!body || !from) return;
        const order: CorpseOrder = { id: corpse, from, wounds: body.wounds, dir, cuts: cuts ?? [], gib };
        setOrders((list) => [...list, order]);
        setTimeout(() => setOrders((list) => list.filter((o) => o !== order)), CORPSE_SECONDS * 1000);
      }),
    [],
  );

  useFrame(() => {
    for (const step of steps) step();
  });

  return (
    <Suspense fallback={null}>
      {orders.map((order) => (
        <Corpse key={order.id} order={order} steps={steps} />
      ))}
    </Suspense>
  );
};
