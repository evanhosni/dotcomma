import { computeVertexData } from "../../../../src/utils/workers/vertexCompute";
import { quantizeVelocity, SPAWN_CLEARANCE, type NpcBody, type Pose } from "./npcBody.js";
import type { CapsuleShape } from "./walker.js";

/** `movement: "free"` (flyers, swimmers): velocity integrated as-is, no gravity, no
 *  ground, no Rapier body — always ready, costs the world nothing. */
export class FreeBody implements NpcBody {
  readonly ready = true;
  private readonly position: { x: number; y: number; z: number };
  private readonly lastPublishedPose: { x: number; y: number; z: number };

  constructor(x: number, z: number, _shape: CapsuleShape) {
    const y = computeVertexData(x, z).height + SPAWN_CLEARANCE;
    this.position = { x, y, z };
    this.lastPublishedPose = { x, y, z };
  }

  get x(): number {
    return this.position.x;
  }
  get y(): number {
    return this.position.y;
  }
  get z(): number {
    return this.position.z;
  }

  step(dt: number, vx: number, vz: number, vy: number | null): void {
    this.position.x += vx * dt;
    this.position.y += (vy ?? 0) * dt;
    this.position.z += vz * dt;
  }

  resolvePose(dt: number, out: Pose): Pose {
    out.x = this.position.x;
    out.y = this.position.y;
    out.z = this.position.z;
    out.vx = quantizeVelocity((out.x - this.lastPublishedPose.x) / dt);
    out.vy = quantizeVelocity((out.y - this.lastPublishedPose.y) / dt);
    out.vz = quantizeVelocity((out.z - this.lastPublishedPose.z) / dt);
    this.lastPublishedPose.x = out.x;
    this.lastPublishedPose.y = out.y;
    this.lastPublishedPose.z = out.z;
    return out;
  }

  dispose(): void {}
}
