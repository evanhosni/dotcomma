import * as THREE from "three";
import { fontOfSize } from "../../../../menus/overlay/utils";
import { LABEL_CANVAS_HEIGHT, LABEL_CANVAS_WIDTH, LABEL_MIDDLE_LIFT, LABEL_PADDING, LABEL_RENDER_ORDER } from "./constants";

/**
 * A line of text lying flat in the sky, face up, its top toward −z: read by a camera looking straight down
 * (the intro's MAV Unit). A canvas texture in the HUD font at a fixed type size, drawn on top of everything,
 * never fogged or tone-mapped: pure white, as the page's copy of the title is. A longer text widens the
 * label: every message reads at the same size.
 */
export class SkyLabel {
  readonly mesh: THREE.Mesh;
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;
  /** World units per canvas pixel. */
  private readonly unit: number;

  constructor(
    private text: string,
    width: number,
    private readonly fontPx: number,
  ) {
    this.canvas.width = LABEL_CANVAS_WIDTH;
    this.canvas.height = LABEL_CANVAS_HEIGHT;
    this.ctx = this.canvas.getContext("2d")!;
    this.unit = width / LABEL_CANVAS_WIDTH;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    // A unit-wide plane, scaled to the canvas's width.
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, LABEL_CANVAS_HEIGHT * this.unit).rotateX(-Math.PI / 2), this.material);
    this.mesh.renderOrder = LABEL_RENDER_ORDER;
    this.draw();
    document.fonts?.ready.then(() => this.draw());
  }

  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.draw();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  /** Sizes the canvas to the text and draws it centred. */
  private draw(): void {
    const { ctx } = this;
    ctx.font = fontOfSize(this.fontPx);
    const width = Math.max(LABEL_CANVAS_WIDTH, Math.ceil(ctx.measureText(this.text).width + LABEL_PADDING * 2));
    if (this.canvas.width !== width) {
      // A canvas that changes size needs a texture of its own size.
      this.canvas.width = width;
      this.texture.dispose();
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.material.map = this.texture;
    }
    ctx.clearRect(0, 0, width, LABEL_CANVAS_HEIGHT);
    ctx.font = fontOfSize(this.fontPx);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(this.text, width / 2, LABEL_CANVAS_HEIGHT / 2 - this.fontPx * LABEL_MIDDLE_LIFT);
    this.texture.needsUpdate = true;
    this.mesh.scale.x = width * this.unit;
  }
}
