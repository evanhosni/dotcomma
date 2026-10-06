import { SPAWN_CLEARANCE, writeResolvedPose, type NpcBody, type Pose } from "./npcBody.js";
import type { PhysicsWorld } from "./physicsWorld.js";

/** `movement: "free"` (flyers, swimmers): velocity integrated as-is, no gravity, no
 *  ground, no Rapier body — costs the world nothing. It starts on the analytic ground
 *  (asked like GroundBody's spawn: standing at `hintFeetY` until answered). */
export class FreeBody implements NpcBody {
  private readonly position: { x: number; y: number; z: number };
  private readonly lastPublishedPose: { x: number; y: number; z: number };
  private spawnGround = NaN;
  private spawned = false;

  constructor(pw: PhysicsWorld, x: number, z: number, hintFeetY: number) {
    pw.heightAt(x, z, (h) => {
      this.spawnGround = h;
    });
    const y = this.takeSpawnGround() ?? hintFeetY;
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

  get ready(): boolean {
    return this.spawned;
  }

  step(dt: number, vx: number, vz: number, vy: number | null): void {
    if (!this.spawned) {
      const y = this.takeSpawnGround();
      if (y === null) return;
      this.position.y = y;
    }
    this.position.x += vx * dt;
    this.position.y += (vy ?? 0) * dt;
    this.position.z += vz * dt;
  }

  resolvePose(dt: number, out: Pose): Pose {
    return writeResolvedPose(this.lastPublishedPose, this.position.x, this.position.y, this.position.z, dt, out);
  }

  dispose(): void {}

  private takeSpawnGround(): number | null {
    if (Number.isNaN(this.spawnGround)) return null;
    this.spawned = true;
    return this.spawnGround + SPAWN_CLEARANCE;
  }
}
