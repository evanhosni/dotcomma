import * as THREE from "three";
import { createRocket } from "../../equippables/rocket-launcher";
import { ROCKET_SPEED } from "../constants";
import type { WeaponSpec } from "../spec";

/** Where a rocket went off: the point, the surface it struck (null: a body, or the air at the end of its
 *  range), and the way it flew. */
export interface RocketBurst {
  weapon: WeaponSpec;
  at: THREE.Vector3;
  normal: THREE.Vector3 | null;
  dir: THREE.Vector3;
}

/** What a rocket meets on its way (the WeaponDriver's world): the first solid surface along a step, and
 *  whether a body is near a point. */
export interface RocketWorld {
  solidAlong(from: THREE.Vector3, dir: THREE.Vector3, length: number): { distance: number; normal: THREE.Vector3 } | null;
  bodyNear(point: THREE.Vector3): boolean;
}

interface Flight {
  weapon: WeaponSpec;
  model: THREE.Group;
  dir: THREE.Vector3;
  travelled: number;
  range: number;
}

const _step = new THREE.Vector3();
const _probe = new THREE.Vector3();
/** A step is checked for bodies at points this far apart (u): a body is ~0.8u across. */
const BODY_PROBE = 0.4;

/**
 * The local player's rockets in flight: each flies straight at ROCKET_SPEED from the launcher's mouth until
 * it meets the world's first solid surface, comes near a body, or has flown its range, and goes off there.
 * Its model is placed in the world each frame (it is a few metres from the camera at most, then gone).
 */
export class Rockets {
  private readonly flights: Flight[] = [];

  constructor(private readonly scene: THREE.Object3D) {}

  /** A rocket of `weapon` from `from` along the unit `dir`, for the weapon's range. */
  launch(weapon: WeaponSpec, from: THREE.Vector3, dir: THREE.Vector3): void {
    const model = createRocket();
    model.position.copy(from);
    model.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    model.updateMatrixWorld(true);
    this.scene.add(model);
    this.flights.push({ weapon, model, dir: dir.clone(), travelled: 0, range: weapon.range });
  }

  /** Flies every rocket one frame; returns those that went off (gone from the scene). */
  step(dt: number, world: RocketWorld): RocketBurst[] {
    const bursts: RocketBurst[] = [];
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const flight = this.flights[i];
      const position = flight.model.position;
      const length = Math.min(ROCKET_SPEED * dt, flight.range - flight.travelled);
      const solid = world.solidAlong(position, flight.dir, length);
      const reach = solid ? solid.distance : length;
      let hitBody = -1;
      for (let d = 0; d <= reach && hitBody < 0; d += BODY_PROBE) if (world.bodyNear(_probe.copy(position).addScaledVector(flight.dir, Math.min(d, reach)))) hitBody = Math.min(d, reach);
      flight.travelled += length;
      if (hitBody >= 0 || solid || flight.travelled >= flight.range) {
        const at = position.clone().addScaledVector(flight.dir, hitBody >= 0 ? hitBody : reach);
        bursts.push({ weapon: flight.weapon, at, normal: hitBody < 0 && solid ? solid.normal : null, dir: flight.dir });
        flight.model.removeFromParent();
        this.flights.splice(i, 1);
        continue;
      }
      position.add(_step.copy(flight.dir).multiplyScalar(length));
      flight.model.updateMatrixWorld(true);
    }
    return bursts;
  }

  dispose(): void {
    for (const flight of this.flights) flight.model.removeFromParent();
    this.flights.length = 0;
  }
}
