import * as THREE from "three";
import { math } from "../math";
// import { biomes } from "./biomes.js";

const _MIN_CELL_SIZE = 6400;
const _FIXED_GRID_SIZE = 5;
const _MIN_CELL_RESOLUTION = 32;

export namespace terrain {
    export class TerrainChunkManager {
        params: any;
        _material: THREE.MeshBasicMaterial;
        materialArray: THREE.MeshBasicMaterial[];
        // biomes: biomes.Biomes;
        radius: number[];
        group: THREE.Group;
        chunks: { [key: string]: any };
        active: any | null;
        queued: any[];
        new: any[];

        constructor(params: any) {
            this.params = params;
            this._material = new THREE.MeshBasicMaterial({
                wireframe: true,
                wireframeLinewidth: 1,
                color: 0xffffff,
                side: THREE.FrontSide,
            });
            this.materialArray = [
                new THREE.MeshBasicMaterial({
                    wireframe: true,
                    wireframeLinewidth: 1,
                    color: 0x00ffff,
                    side: THREE.FrontSide,
                }),
                // Add other materials as needed
            ];
            // this.biomes = new biomes.Biomes();
            this.radius = [100000, 100001]; // TODO not sure what the point of this is
            this.group = new THREE.Group();
            this.params.scene.add(this.group);
            this.chunks = {};
            this.active = null;
            this.queued = [];
            this.new = [];
        }

        Update() {
            if (this.active) {
                const iteratorResult = this.active.rebuildIterator.next();
                if (iteratorResult.done) {
                    this.active = null;
                }
            } else {
                const chunk = this.queued.pop();
                if (chunk) {
                    this.active = chunk;
                    this.active.rebuildIterator = this.BuildChunk(chunk);
                    this.new.push(chunk);
                }
            }

            if (this.active) {
                return;
            }

            if (!this.queued.length) {
                for (const chunk of this.new) {
                    chunk.plane.visible = true;
                }

                this.new = [];
            }

            if (!this.active) {
                const camera = this.params.camera;
                const xp = camera.position.x + _MIN_CELL_SIZE * 0.5;
                const yp = camera.position.z + _MIN_CELL_SIZE * 0.5;
                const xc = Math.floor(xp / _MIN_CELL_SIZE);
                const zc = Math.floor(yp / _MIN_CELL_SIZE);
                const keys: { [key: string]: { position: number[] } } = {};

                for (let x = -_FIXED_GRID_SIZE; x <= _FIXED_GRID_SIZE; x++) {
                    for (
                        let z = -_FIXED_GRID_SIZE;
                        z <= _FIXED_GRID_SIZE;
                        z++
                    ) {
                        const k = `${x + xc}/${z + zc}`;
                        keys[k] = { position: [x + xc, z + zc] };
                    }
                }

                for (const chunkKey in this.chunks) {
                    if (!keys[chunkKey]) {
                        this.DestroyChunk(chunkKey);
                    }
                }

                const difference = { ...keys };
                for (const chunkKey in this.chunks) {
                    delete difference[chunkKey];
                }

                for (const chunkKey in difference) {
                    if (chunkKey in this.chunks) {
                        continue;
                    }

                    const [xp, zp] = difference[chunkKey].position;
                    const offset = new THREE.Vector2(
                        xp * _MIN_CELL_SIZE,
                        zp * _MIN_CELL_SIZE
                    );
                    const chunk = this.QueueChunk(offset, _MIN_CELL_SIZE);
                    this.chunks[chunkKey] = {
                        position: [xc, zc],
                        chunk: chunk,
                    };
                }
            }
        }

        QueueChunk(offset: THREE.Vector2, width: number) {
            const size = new THREE.Vector3(width, 0, width);
            const randomMaterial =
                this.materialArray[
                    Math.floor(Math.random() * this.materialArray.length)
                ];
            const plane = new THREE.Mesh(
                new THREE.PlaneGeometry(
                    size.x,
                    size.z,
                    _MIN_CELL_RESOLUTION,
                    _MIN_CELL_RESOLUTION
                ),
                randomMaterial
            );
            plane.castShadow = false;
            plane.receiveShadow = true;
            plane.rotation.x = -Math.PI / 2;
            this.group.add(plane);

            const chunk = {
                offset: new THREE.Vector3(offset.x, offset.y, 0),
                plane: plane,
                rebuildIterator: null,
            };

            chunk.plane.visible = false;
            this.queued.push(chunk);

            return chunk;
        }

        *BuildChunk(chunk: any) {
            const NUM_STEPS = 5000; //TODO was 2000 originally (works well on chrome), 50 is more performant for firefox...make it variable based on browser? maybe make infinite for initial gen to make load time quicker
            const offset = chunk.offset;
            const pos = chunk.plane.geometry.attributes.position;
            const colours: any[] = [];
            let count = 0;

            for (let i = 0; i < pos.count; i++) {
                const v = new THREE.Vector3(
                    pos.getX(i),
                    pos.getY(i),
                    pos.getZ(i)
                );
                pos.setXYZ(i, v.x, v.y, this.GenerateHeight(chunk, v)); //TODO add some x, y randomization? (see below)
                // pos.setXYZ(i, v.x + Math.floor(new Math.seedrandom((v.x + offset.x) + "/" + (v.y + offset.y))() * 50), v.y + Math.floor(new Math.seedrandom((v.y + offset.y) + "/" + (v.x + offset.x))() * 50), this.GenerateHeight(chunk, v));
                colours.push(
                    this.GenerateColor(
                        chunk,
                        v.x + offset.x,
                        v.z,
                        -v.y + offset.y
                    )
                );
                count++;

                if (count > NUM_STEPS) {
                    count = 0;
                    yield;
                }
            }

            yield;
            chunk.plane.geometry.elementsNeedUpdate = true;
            chunk.plane.geometry.verticesNeedUpdate = true;
            chunk.plane.geometry.computeVertexNormals();
            chunk.plane.position.set(offset.x, 0, offset.y);
        }

        DestroyChunk(chunkKey: string) {
            const chunkData = this.chunks[chunkKey];
            chunkData.chunk.plane.geometry.dispose();
            chunkData.chunk.plane.material.dispose();
            this.group.remove(chunkData.chunk.plane);
            delete this.chunks[chunkKey];
        }

        GenerateHeight(chunk: any, v: THREE.Vector3) {
            const offset = chunk.offset;
            const heightPairs: number[][] = [];
            let normalization = 0;
            let z = 0;
            const x = v.x + offset.x;
            const y = -v.y + offset.y;

            const position = new THREE.Vector2(offset.x, offset.y);

            const distance = position.distanceTo(new THREE.Vector2(x, y));
            let norm =
                1.0 -
                math.sat(
                    (distance - this.radius[0]) /
                        (this.radius[1] - this.radius[0])
                );
            norm = norm * norm * (3 - 2 * norm);

            // const heightAtVertex = this.biomes.Height(x, y);

            const heightAtVertex = 1;

            heightPairs.push([heightAtVertex, norm]);
            normalization += heightPairs[heightPairs.length - 1][1];

            if (normalization > 0) {
                for (const h of heightPairs) {
                    z += (h[0] * h[1]) / normalization;
                }
            }

            return z;
        }

        GenerateColor(chunk: any, x: number, y: number, z: number) {
            // Update this function to return the appropriate color based on the chunk type
            if (chunk.type === "GRASS") {
                return { r: 0, g: 1, b: 0 };
            }

            return { r: 1, g: 1, b: 1 };
        }
    }
}