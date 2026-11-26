import * as THREE from "three";
import { LABEL_RENDER_ORDER, PROMPT_ENTER, PROMPT_FONT_PX, PROMPT_WIDTH, TITLE_ABOVE_CENTER, TITLE_DEPTH, TITLE_FONT_PX, TITLE_WIDTH } from "./constants";
import { SkyLabel } from "./SkyLabel";

/**
 * The intro's scene layer: the title and the prompt written in the sky under the MAV Unit (SkyLabel.ts), over
 * a full-screen black drawn IN the scene just under them (a page black would hide the text too). Only this
 * player's camera ever looks down on them.
 */
export class SkyTitle {
  private readonly title = new SkyLabel("dotcomma", TITLE_WIDTH * TITLE_DEPTH, TITLE_FONT_PX);
  private readonly prompt = new SkyLabel(PROMPT_ENTER, PROMPT_WIDTH * TITLE_DEPTH, PROMPT_FONT_PX);
  private readonly black = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: "uniform float uOpacity;\nvoid main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uOpacity); }",
      uniforms: { uOpacity: { value: 1 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );

  constructor(scene: THREE.Scene) {
    this.black.frustumCulled = false;
    this.black.renderOrder = LABEL_RENDER_ORDER - 1;
    scene.add(this.black, this.title.mesh, this.prompt.mesh);
  }

  /** The height the prompt is written at: the unit is past the title below it. */
  get promptY(): number {
    return this.prompt.mesh.position.y;
  }

  setPrompt(text: string): void {
    this.prompt.setText(text);
  }

  /** 0 = clear, 1 = black. */
  setBlack(opacity: number): void {
    this.black.material.uniforms.uOpacity.value = opacity;
  }

  /** The title and the prompt under the unit's origin `unit`, as its camera sees them from there. */
  placeUnder(unit: THREE.Vector3): void {
    const y = unit.y - TITLE_DEPTH;
    this.title.mesh.position.set(unit.x, y, unit.z - TITLE_ABOVE_CENTER * TITLE_DEPTH);
    this.prompt.mesh.position.set(unit.x, y, unit.z);
  }

  /** The text keeps under the unit across, not down: the unit falls straight through it whatever its host does. */
  followAcross(unit: THREE.Vector3): void {
    if (!this.title.mesh.visible) return;
    this.title.mesh.position.x = this.prompt.mesh.position.x = unit.x;
    this.title.mesh.position.z = unit.z - TITLE_ABOVE_CENTER * TITLE_DEPTH;
    this.prompt.mesh.position.z = unit.z;
  }

  /** The title has gone by: its meshes stop drawing. */
  hideText(): void {
    this.title.mesh.visible = this.prompt.mesh.visible = false;
  }

  dispose(): void {
    this.title.dispose();
    this.prompt.dispose();
    this.black.removeFromParent();
    this.black.geometry.dispose();
    this.black.material.dispose();
  }
}
