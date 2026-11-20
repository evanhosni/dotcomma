import { useEffect, useRef, useSyncExternalStore } from "react";
import { statRatings } from "../../objects/actors/scroller/utils";
import { getSeatedVehicle, onSeatChange } from "../../vehicles/store";
import { HUD_Z_INDEX, PANEL_STYLE } from "./constants";

const DRIVING_PANEL_STYLE: React.CSSProperties = { ...PANEL_STYLE, position: "fixed", right: 12, bottom: 12, zIndex: HUD_Z_INDEX };
const BAR_CELLS = 10;
const HINT = "W/S  drive · brake · reverse\nA/D  steer\nSPC  handbrake\nF    get out";

const bar = (rating: number): string => {
  const filled = Math.round(Math.min(Math.max(rating, 0), 1) * BAR_CELLS);
  return "█".repeat(filled) + "░".repeat(BAR_CELLS - filled);
};

/** The car the player sits in: its name and paint, its stats, the speedometer and the keys
 *  (bottom-right, only while driving). The speed is written to a text node, never React state. */
export const DrivingOverlay = () => {
  const car = useSyncExternalStore(onSeatChange, getSeatedVehicle);
  const speedRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!car) return;
    let frame = 0;
    const tick = () => {
      if (speedRef.current) speedRef.current.textContent = String(Math.round(Math.abs(car.vehicle.state.forwardSpeed))).padStart(4);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [car]);

  if (!car) return null;
  const stats = statRatings(car.vehicle.stats)
    .map(([name, rating]) => `${name.padEnd(9)}${bar(rating)}`)
    .join("\n");
  return (
    <div style={DRIVING_PANEL_STYLE}>
      <span style={{ color: car.color }}>■ </span>
      {car.name.toUpperCase()}
      {"\n"}
      <span ref={speedRef} /> u/s{"\n\n"}
      {stats}
      {"\n\n"}
      {HINT}
    </div>
  );
};
