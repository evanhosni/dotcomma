import * as THREE from "three";
import {
  activeLampHeads,
  LAMP_COLOR_GREEN,
  LAMP_COLOR_WARM,
  lampGlowAccumGLSL,
  registerLampHeads,
  setLampHeadColor,
} from "./lampGlow";

describe("lamp glow", () => {
  it("selects colors from LAMP_COLORS by w = index + 1", () => {
    expect(lampGlowAccumGLSL("p")).toContain(
      "vec3 lampCol = lampG.w > 3.5 ? vec3(0.15, 1.0, 0.4) : lampG.w > 2.5 ? vec3(1.0, 0.72, 0.1)" +
        " : lampG.w > 1.5 ? vec3(1.0, 0.16, 0.1) : vec3(1.0, 0.82, 0.45);",
    );
  });

  it("registers heads under unique keys and removes exactly them", () => {
    const head = () => ({ position: new THREE.Vector3(1, 2, 3), color: LAMP_COLOR_WARM });
    const disposeA = registerLampHeads("test", [head(), head()]);
    const disposeB = registerLampHeads("test", [head()]);
    expect(activeLampHeads.size).toBe(3);
    disposeA();
    expect(activeLampHeads.size).toBe(1);
    disposeB();
    expect(activeLampHeads.size).toBe(0);
  });

  it("recolors in place", () => {
    const head = { position: new THREE.Vector3(), color: LAMP_COLOR_WARM };
    setLampHeadColor(head, LAMP_COLOR_GREEN);
    expect(head.color).toBe(LAMP_COLOR_GREEN);
  });
});
