import { ARM_BONES } from "../constants";
import { unmodelledEquippables } from "../registry";
import { EQUIPPABLES } from "../spec";
import { WEAPONS } from "../../weapons/spec";

describe("equippables", () => {
  it("every one has a model, arms the rig has, and a weapon that exists", () => {
    expect(unmodelledEquippables()).toEqual([]);
    for (const spec of Object.values(EQUIPPABLES)) {
      expect(spec.arms.length).toBeGreaterThan(0);
      expect(new Set(spec.arms).size).toBe(spec.arms.length);
      for (const arm of spec.arms) expect(ARM_BONES[arm]).toBeDefined();
      if (spec.weapon) expect(WEAPONS[spec.weapon]).toBeDefined();
    }
  });
});
