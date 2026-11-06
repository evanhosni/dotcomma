/** @jest-environment node */
import { readFileSync } from "fs";
import path from "path";
import { AnimationChannel } from ".";
import { fadeProgressAt, frameTimeAt, glbClipDurations, playheadAt, wrapClipTime } from "./utils";

const DURATIONS = { walk: 2, wave: 4 };

const channelAt = (nowMs: number, durations = DURATIONS): AnimationChannel => {
  const c = new AnimationChannel({ durations });
  c.setClock(nowMs);
  return c;
};

const timeAt = (c: AnimationChannel, nowMs: number): number => {
  c.setClock(nowMs);
  return c.time;
};

describe("AnimationChannel", () => {
  it("play anchors at the clock and the playhead advances from it", () => {
    const c = channelAt(1000);
    c.play("walk");
    expect(c.state.clip).toBe("walk");
    expect(c.state.changedAt).toBe(1000);
    expect(c.version).toBe(1);
    expect(playheadAt(c.state, 2500)).toBeCloseTo(1.5);
    expect(timeAt(c, 3500)).toBeCloseTo(0.5);
  });

  it("replaying a looping clip keeps its phase; a one-shot restarts", () => {
    const c = channelAt(0);
    c.play("walk");
    c.setClock(700);
    c.play("walk");
    expect(c.state.anchor).toBe(0);
    expect(c.version).toBe(1);
    c.play("wave", { loop: "once" });
    c.setClock(900);
    c.play("wave", { loop: "once" });
    expect(c.state.anchor).toBe(900);
  });

  it("pause holds the frame; resume continues without a jump", () => {
    const c = channelAt(0);
    c.play("walk");
    c.setClock(1500);
    c.pause();
    expect(c.paused).toBe(true);
    expect(timeAt(c, 9000)).toBeCloseTo(1.5);
    c.resume();
    expect(timeAt(c, 9000)).toBeCloseTo(1.5);
    expect(timeAt(c, 9250)).toBeCloseTo(1.75);
  });

  it("setSpeed keeps the frame on screen", () => {
    const c = channelAt(0);
    c.play("walk");
    c.setClock(500);
    c.setSpeed(2);
    expect(timeAt(c, 500)).toBeCloseTo(0.5);
    expect(timeAt(c, 750)).toBeCloseTo(1);
  });

  it("reverse flips direction from the frame on screen, and wraps a loop backwards", () => {
    const c = channelAt(0);
    c.play("walk");
    c.setClock(500);
    c.reverse();
    expect(timeAt(c, 500)).toBeCloseTo(0.5);
    expect(timeAt(c, 1000)).toBeCloseTo(0);
    expect(timeAt(c, 1250)).toBeCloseTo(1.75);
  });

  it("a finished one-shot reversed plays back from its last frame", () => {
    const c = channelAt(0);
    c.play("wave", { loop: "once" });
    c.setClock(10000);
    expect(c.finished).toBe(true);
    c.reverse();
    expect(timeAt(c, 11000)).toBeCloseTo(3);
    expect(timeAt(c, 20000)).toBe(0);
    expect(c.finished).toBe(true);
  });

  it("a one-shot played reversed starts at its end", () => {
    const c = channelAt(0);
    c.play("wave", { loop: "once", reverse: true });
    expect(timeAt(c, 1000)).toBeCloseTo(3);
  });

  it("pingpong bounces between the ends", () => {
    expect(wrapClipTime("pingpong", 1.5, 2)).toBeCloseTo(1.5);
    expect(wrapClipTime("pingpong", 2.5, 2)).toBeCloseTo(1.5);
    expect(wrapClipTime("pingpong", 4.5, 2)).toBeCloseTo(0.5);
  });

  it("frameRate holds the clock at the last tick of a phase-shifted grid", () => {
    expect(frameTimeAt(149, 10)).toBe(100);
    expect(frameTimeAt(200, 10)).toBe(200);
    expect(frameTimeAt(149, 10, 30)).toBe(70);
    expect(frameTimeAt(175, 10, 30)).toBe(170);
    expect(frameTimeAt(175, 0)).toBe(175);
  });

  it("channel defaults apply under each play's own params", () => {
    const c = new AnimationChannel({ defaults: { frameRate: 10, intensity: 0.5 } });
    c.play("walk", { intensity: 0.8 });
    expect(c.state.frameRate).toBe(10);
    expect(c.state.intensity).toBe(0.8);
  });

  it("setIntensity clamps to 0..1", () => {
    const c = channelAt(0);
    c.play("walk");
    c.setIntensity(3);
    expect(c.state.intensity).toBe(1);
  });

  it("a faded play holds the previous clip's frame and blends over `fade` seconds", () => {
    const c = channelAt(0);
    c.play("walk");
    c.setClock(500);
    c.play("wave", { fade: 1 });
    expect(c.state.fadeClip).toBe("walk");
    expect(c.state.fadeTime).toBeCloseTo(0.5);
    expect(fadeProgressAt(c.state, 1000)).toBeCloseTo(0.5);
    expect(fadeProgressAt(c.state, 2000)).toBe(1);
  });

  it("seek jumps the playhead", () => {
    const c = channelAt(0);
    c.play("walk");
    c.seek(1.25);
    expect(timeAt(c, 0)).toBeCloseTo(1.25);
  });

  it("stop clears the clip and bumps the version once", () => {
    const c = channelAt(0);
    c.play("walk");
    c.stop();
    expect(c.clip).toBeNull();
    const v = c.version;
    c.stop();
    expect(c.version).toBe(v);
  });

  it("adopt copies a published state without touching an equal one", () => {
    const a = channelAt(10);
    const b = new AnimationChannel();
    a.play("walk", { speed: 0.5 });
    b.adopt(a.state);
    expect(b.state).toEqual(a.state);
    const v = b.version;
    b.adopt(a.state);
    expect(b.version).toBe(v);
  });
});

describe("glbClipDurations", () => {
  it("reads the beeble's clip durations", () => {
    const durations = glbClipDurations(readFileSync(path.join(__dirname, "../../public/models/beeble.glb")));
    expect(durations.walk).toBeCloseTo(1.292, 3);
    expect(durations["stare at hands"]).toBeCloseTo(4.958, 3);
  });
});
