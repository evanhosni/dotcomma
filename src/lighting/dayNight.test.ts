import { nightBlendAt } from "./dayNight";

describe("nightBlendAt", () => {
  const day = 12000;
  const night = 12000;
  const transition = 2000;
  const cycle = day + transition + night + transition;

  it("holds day, ramps through dusk, holds night, ramps back through dawn", () => {
    expect(nightBlendAt(0, day, night, transition)).toBe(0);
    expect(nightBlendAt(day + transition / 2, day, night, transition)).toBeCloseTo(0.5);
    expect(nightBlendAt(day + transition + 1, day, night, transition)).toBe(1);
    expect(nightBlendAt(day + transition + night + transition / 4, day, night, transition)).toBeCloseTo(0.75);
  });

  it("repeats every cycle", () => {
    expect(nightBlendAt(cycle * 7 + day + 500, day, night, transition)).toBe(nightBlendAt(day + 500, day, night, transition));
  });
});
