import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getLocalPlayerBody, isPlayerHeld } from "../../player/store";
import { equippableOf } from "../../equippables/spec";
import { equip, getCarried, getEquipped, isEquipWheelOpen, setEquipWheelOpen, subscribeEquipment } from "../../equippables/store";
import { FONT, HUD_COLOR, HUD_Z_INDEX, PANEL_BACKGROUND } from "./constants";

const WHEEL_KEY = "Tab";
const SIZE = 300;
const INNER = 46;
const OUTER = 140;
/** The mouse is steered inside a disc this big (px of movement); past DEAD_ZONE of it a slice is picked. */
const STEER_RADIUS = 120;
const DEAD_ZONE = 30;
const EMPTY_HANDED = "";

/** The wheel's slices: empty hands, then what the player carries, clockwise from the top. */
const choicesOf = (carried: readonly string[]): string[] => [EMPTY_HANDED, ...carried];
const labelOf = (id: string): string => (id === EMPTY_HANDED ? "empty-handed" : (equippableOf(id)?.name ?? id));

/** The angle of slice `i` of `n` (radians, clockwise from the top). */
const angleOf = (i: number, n: number): number => (i / n) * Math.PI * 2;

/** The slice the steer vector points into. */
const sliceAt = (dx: number, dy: number, n: number): number => {
  const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(angle / ((Math.PI * 2) / n)) % n;
};

/** An SVG path of one slice of the ring. */
const slicePath = (i: number, n: number): string => {
  const half = Math.PI / n;
  const a0 = angleOf(i, n) - half;
  const a1 = angleOf(i, n) + half;
  const c = SIZE / 2;
  const at = (r: number, a: number) => `${c + Math.sin(a) * r} ${c - Math.cos(a) * r}`;
  const large = half * 2 > Math.PI ? 1 : 0;
  return `M ${at(INNER, a0)} L ${at(OUTER, a0)} A ${OUTER} ${OUTER} 0 ${large} 1 ${at(OUTER, a1)} L ${at(INNER, a1)} A ${INNER} ${INNER} 0 ${large} 0 ${at(INNER, a0)} Z`;
};

/** Only a beeble at play picks what to hold: not a MAV Unit, not while the intro or a death holds the player. */
const canPick = (): boolean => !!document.pointerLockElement && !isPlayerHeld() && getLocalPlayerBody()?.form === "host";

/**
 * THE equip wheel: held Tab opens it over the centre of the screen, the mouse steers to a slice instead of
 * turning the view, and letting go of Tab takes the slice's equippable in hand (equippables/store.ts). The
 * HUD's green-on-black (constants.ts).
 */
export const EquipWheelOverlay = () => {
  const open = useSyncExternalStore(subscribeEquipment, isEquipWheelOpen);
  const carried = useSyncExternalStore(subscribeEquipment, getCarried);
  const choices = choicesOf(carried);
  const [picked, setPickedState] = useState(0);
  const pickedRef = useRef(0);
  const setPicked = (i: number) => {
    pickedRef.current = i;
    setPickedState(i);
  };
  const steer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== WHEEL_KEY || !document.pointerLockElement) return;
      // Never the browser's focus change while playing.
      e.preventDefault();
      if (e.repeat || isEquipWheelOpen() || !canPick()) return;
      steer.current = { x: 0, y: 0 };
      setPicked(Math.max(0, choicesOf(getCarried()).indexOf(getEquipped())));
      setEquipWheelOpen(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== WHEEL_KEY || !isEquipWheelOpen()) return;
      e.preventDefault();
      setEquipWheelOpen(false);
      equip(choicesOf(getCarried())[pickedRef.current] ?? EMPTY_HANDED);
    };
    // Before the look controls (drei's PointerLockControls, on the document): the view holds still meanwhile.
    const onMouseMove = (e: MouseEvent) => {
      if (!isEquipWheelOpen()) return;
      e.stopImmediatePropagation();
      const s = steer.current;
      s.x += e.movementX;
      s.y += e.movementY;
      const length = Math.hypot(s.x, s.y);
      if (length > STEER_RADIUS) {
        s.x *= STEER_RADIUS / length;
        s.y *= STEER_RADIUS / length;
      }
      if (length > DEAD_ZONE) setPicked(sliceAt(s.x, s.y, choicesOf(getCarried()).length));
    };
    const close = () => setEquipWheelOpen(false);
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("mousemove", onMouseMove, { capture: true });
    window.addEventListener("blur", close);
    document.addEventListener("pointerlockchange", close);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("mousemove", onMouseMove, { capture: true });
      window.removeEventListener("blur", close);
      document.removeEventListener("pointerlockchange", close);
    };
  }, []);

  if (!open) return null;
  const n = choices.length;
  const c = SIZE / 2;
  return (
    <svg
      width={SIZE}
      height={SIZE}
      style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: HUD_Z_INDEX, pointerEvents: "none", fontFamily: FONT }}
    >
      {choices.map((id, i) => {
        const a = angleOf(i, n);
        const r = (INNER + OUTER) / 2;
        const selected = i === picked;
        return (
          <g key={id || "empty-handed"}>
            <path d={slicePath(i, n)} fill={selected ? "rgba(0,255,0,0.25)" : PANEL_BACKGROUND} stroke={HUD_COLOR} strokeWidth={selected ? 2 : 1} />
            <text x={c + Math.sin(a) * r} y={c - Math.cos(a) * r} fill={HUD_COLOR} fontSize={13} textAnchor="middle" dominantBaseline="middle">
              {labelOf(id)}
            </text>
          </g>
        );
      })}
      <text x={c} y={c} fill={HUD_COLOR} fontSize={11} textAnchor="middle" dominantBaseline="middle">
        {labelOf(choices[picked] ?? EMPTY_HANDED)}
      </text>
    </svg>
  );
};
