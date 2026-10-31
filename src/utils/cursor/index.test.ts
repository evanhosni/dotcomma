/** The hover arbiter: the nearest claim gets the mouse, and the crosshair stays grown while ANY claim wants it. */
import { claimHover, releaseHover, type HoverTarget } from ".";

const target = (distance: number, growsCursor = true): HoverTarget & { got: string[] } => {
  const got: string[] = [];
  return { distance, growsCursor, got, onMouse: (e) => got.push(e.type) };
};
const cursorSize = () => document.getElementById("game-cursor")!.style.width;

describe("hover arbiter", () => {
  it("sends each mouse event to the nearest claim only", () => {
    const near = target(2);
    const far = target(5);
    claimHover(far);
    claimHover(near);
    window.dispatchEvent(new MouseEvent("click"));
    window.dispatchEvent(new MouseEvent("pointerdown"));
    expect(near.got).toEqual(["click", "pointerdown"]);
    expect(far.got).toEqual([]);
    releaseHover(near);
    window.dispatchEvent(new MouseEvent("click"));
    expect(far.got).toEqual(["click"]);
    releaseHover(far);
  });

  it("keeps the crosshair grown until the last growing claim leaves", () => {
    const a = target(1);
    const b = target(2);
    const quiet = target(3, false);
    claimHover(quiet);
    expect(cursorSize()).toBe("2px");
    claimHover(a);
    claimHover(b);
    releaseHover(a);
    expect(cursorSize()).toBe("6px");
    releaseHover(b);
    expect(cursorSize()).toBe("2px");
    releaseHover(quiet);
    window.dispatchEvent(new MouseEvent("click"));
    expect(quiet.got).toEqual([]);
  });
});
