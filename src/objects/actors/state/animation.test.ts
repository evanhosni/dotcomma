import { AnimationChannel, animationClipTime } from "./animation";

describe("AnimationChannel (play / pause / resume / stop / speed)", () => {
  it("play records the clock and clip time advances from it", () => {
    const c = new AnimationChannel();
    c.setClock(1000);
    c.play("walk");
    expect(c.state.clip).toBe("walk");
    expect(c.state.t0).toBe(1000);
    expect(c.state.changedAt).toBe(1000);
    expect(c.version).toBe(1);
    expect(animationClipTime(c.state, 3500)).toBeCloseTo(2.5);
  });

  it("replaying the same looping clip keeps its phase; a one-shot restarts", () => {
    const c = new AnimationChannel();
    c.setClock(0);
    c.play("walk");
    c.setClock(700);
    c.play("walk");
    expect(c.state.t0).toBe(0);
    expect(c.version).toBe(1);
    c.play("wave", { loop: "once" });
    c.setClock(900);
    c.play("wave", { loop: "once" });
    expect(c.state.t0).toBe(900);
  });

  it("pause freezes the clip time; resume continues without a jump", () => {
    const c = new AnimationChannel();
    c.setClock(0);
    c.play("walk");
    c.setClock(2000);
    c.pause();
    expect(c.state.paused).toBe(true);
    expect(animationClipTime(c.state, 9000)).toBeCloseTo(2);
    c.setClock(5000);
    c.resume();
    expect(c.state.paused).toBe(false);
    expect(animationClipTime(c.state, 5000)).toBeCloseTo(2);
    expect(animationClipTime(c.state, 6000)).toBeCloseTo(3);
  });

  it("setSpeed re-anchors t0 so the elapsed clip time is continuous", () => {
    const c = new AnimationChannel();
    c.setClock(0);
    c.play("walk");
    c.setClock(4000); // 4s in at speed 1
    c.setSpeed(2);
    expect(animationClipTime(c.state, 4000)).toBeCloseTo(4);
    expect(animationClipTime(c.state, 5000)).toBeCloseTo(6);
  });

  it("stop clears the clip and bumps the version once", () => {
    const c = new AnimationChannel();
    c.setClock(0);
    c.play("walk");
    c.stop();
    expect(c.state.clip).toBeNull();
    const v = c.version;
    c.stop();
    expect(c.version).toBe(v);
  });

  it("adopt copies a published state without touching an equal one", () => {
    const a = new AnimationChannel();
    const b = new AnimationChannel();
    a.setClock(10);
    a.play("idle", { speed: 0.5 });
    b.adopt(a.state);
    expect(b.state).toEqual(a.state);
    const v = b.version;
    b.adopt(a.state);
    expect(b.version).toBe(v);
  });
});
