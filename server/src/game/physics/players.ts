import type * as RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "./world.js";

/** A kinematic capsule per player, following the client-reported CENTER position, so NPCs collide with players. */

/** Player.tsx PLAYER_RADIUS / PLAYER_HEIGHT. */
const PLAYER_RADIUS = 0.5;
const PLAYER_HEIGHT = 2;

export interface PlayerPose {
  id: string;
  x: number;
  y: number;
  z: number;
}

export class PlayerBodies {
  private readonly bodies = new Map<string, { body: RAPIER.RigidBody; seen: number }>();
  private generation = 0;

  constructor(private readonly pw: PhysicsWorld) {}

  get size(): number {
    return this.bodies.size;
  }

  /** Drops everyone not listed. */
  sync(players: Iterable<PlayerPose>): void {
    this.generation++;
    for (const p of players) {
      let pb = this.bodies.get(p.id);
      if (!pb) {
        pb = { body: this.pw.createCapsule(p.x, p.y - PLAYER_HEIGHT / 2, p.z, PLAYER_RADIUS, PLAYER_HEIGHT).body, seen: 0 };
        this.bodies.set(p.id, pb);
      } else {
        pb.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      }
      pb.seen = this.generation;
    }
    for (const [id, pb] of this.bodies) {
      if (pb.seen !== this.generation) {
        this.pw.removeBody(pb.body);
        this.bodies.delete(id);
      }
    }
  }

  dispose(): void {
    for (const pb of this.bodies.values()) this.pw.removeBody(pb.body);
    this.bodies.clear();
  }
}
