import { angleDiffAbs, lerpAngle, Motion, stepAngle, wrapAngle } from "./motion";

describe("Motion (state machine movement output)", () => {
  const at = (x: number, z: number) => ({ current: { x, y: 0, z } });

  it("heading moves along (sin θ, cos θ) — the facing convention", () => {
    const m = new Motion(at(0, 0));
    m.heading(0, 5);
    expect(m.out.vx).toBeCloseTo(0);
    expect(m.out.vz).toBeCloseTo(5);
    m.heading(Math.PI / 2, 5);
    expect(m.out.vx).toBeCloseTo(5);
    expect(m.out.vz).toBeCloseTo(0);
    m.faceHeading();
    expect(m.yaw).toBeCloseTo(Math.PI / 2);
  });

  it("toward aims at a point and stops inside the arrive radius", () => {
    const m = new Motion(at(0, 0));
    m.toward(3, 4, 10);
    expect(m.out.vx).toBeCloseTo(6);
    expect(m.out.vz).toBeCloseTo(8);
    m.toward(0.5, 0, 10, 1);
    expect(m.out.vx).toBe(0);
    expect(m.out.vz).toBe(0);
  });

  it("stop zeroes horizontal velocity and hands the vertical back to gravity", () => {
    const m = new Motion(at(0, 0));
    m.move(1, 2).fly(3);
    expect(m.moving).toBe(true);
    m.stop();
    expect(m.out).toEqual({ vx: 0, vy: null, vz: 0, yaw: 0 });
    expect(m.moving).toBe(false);
  });

  it("turnToward steps the facing by at most maxStep along the shortest arc", () => {
    const m = new Motion(at(0, 0));
    m.face(0);
    m.turnToward(-1, 0, 0.1); // target −π/2
    expect(m.yaw).toBeCloseTo(-0.1);
    m.turnToward(-1, 0, 10); // big step lands exactly
    expect(m.yaw).toBeCloseTo(-Math.PI / 2);
    expect(m.facingErrorTo(-1, 0)).toBeCloseTo(0);
  });

  it("angle helpers wrap and lerp along the shortest arc", () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(angleDiffAbs(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(0.2);
    // Halfway between −π+0.1 and π−0.1 along the SHORT arc is ±π (the same angle).
    expect(Math.abs(wrapAngle(lerpAngle(-Math.PI + 0.1, Math.PI - 0.1, 0.5) - Math.PI))).toBeCloseTo(0);
    expect(stepAngle(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(stepAngle(0, 0.1, 0.25)).toBeCloseTo(0.1);
  });
});
