/** Collects one chunk's particles (positions ABSOLUTE; the chunk rebases them). */
export class ParticleWriter {
  readonly origins: number[] = [];
  readonly velocities: number[] = [];
  readonly lives: number[] = [];
  readonly phases: number[] = [];
  readonly sizes: number[] = [];
  readonly seeds: number[] = [];

  push(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, phase: number, size: number, seed: number): void {
    this.origins.push(x, y, z);
    this.velocities.push(vx, vy, vz);
    this.lives.push(life);
    this.phases.push(phase);
    this.sizes.push(size);
    this.seeds.push(seed);
  }

  get count(): number {
    return this.lives.length;
  }
}
