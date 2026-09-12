import { computeVertexData } from "../../../../src/utils/workers/vertexCompute";
import { quantizeVelocity, SPAWN_CLEARANCE, type NpcBody, type Pose } from "./npcBody.js";
import type { CapsuleShape } from "./walker.js";

/**
 * FREE BODY — an NPC with `movement: "free"` (flyers, swimmers): its motion
 * output is integrated as a plain 3-axis velocity — no gravity, no ground
 * following, no collision — exactly what the client's kinematic mover does
 * for a local free actor. It holds no chunks and has no Rapier body, so it is
 * always ready and costs the world nothing. Spawns at the analytic ground and
 * flies from there.
 */
export class FreeBody implements NpcBody {
  readonly ready = true;
  private readonly p: { x: number; y: number; z: number };
  private readonly prev: { x: number; y: number; z: number };

  constructor(x: number, z: number, _shape: CapsuleShape) {
    const y = computeVertexData(x, z).height + SPAWN_CLEARANCE;
    this.p = { x, y, z };
    this.prev = { x, y, z };
  }

  get x(): number {
    return this.p.x;
  }
  get y(): number {
    return this.p.y;
  }
  get z(): number {
    return this.p.z;
  }

  step(dt: number, vx: number, vz: number, vy: number | null): void {
    this.p.x += vx * dt;
    this.p.y += (vy ?? 0) * dt;
    this.p.z += vz * dt;
  }

  pose(dt: number, out: Pose): Pose {
    out.x = this.p.x;
    out.y = this.p.y;
    out.z = this.p.z;
    out.vx = quantizeVelocity((out.x - this.prev.x) / dt);
    out.vy = quantizeVelocity((out.y - this.prev.y) / dt);
    out.vz = quantizeVelocity((out.z - this.prev.z) / dt);
    this.prev.x = out.x;
    this.prev.y = out.y;
    this.prev.z = out.z;
    return out;
  }

  dispose(): void {}
}
