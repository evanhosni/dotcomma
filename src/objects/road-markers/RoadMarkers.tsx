import { useFrame } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { TaskQueue } from "../../utils/task-queue/TaskQueue";
import { getRoadMarkers, getVertexData } from "../../world/vertexData";

const MARKER_CHUNK_SIZE = 256; // world units per instanced mesh (one draw call)
const UPDATE_INTERVAL_FRAMES = 31;
const STREET_MARKER_SPACING = 9;
const FREEWAY_MARKER_SPACING = 11;
const MARKER_HEIGHT = 0.16;

// Marker placement runs computeVertexData per candidate on the main thread —
// budgeted through a queue so a ring of fresh chunks can't stack into one frame.
const markerQueue = new TaskQueue();

interface MarkerChunk {
  mesh: THREE.InstancedMesh | null;
  disposed: boolean;
}

export interface RoadMarkersProps {
  /** Camera distance within which marker chunks are built. */
  renderDistance?: number;
}

/**
 * Raised pavement markers along city road centerlines — small unlit 3D studs
 * instead of painted lines (paint shimmered against the quantized terrain).
 * Positions come from the actual voronoi road edges (world/vertexData
 * getRoadMarkers), one InstancedMesh per 256u chunk, oriented along the road.
 * Unlit yellow reads as retroreflective at night. No colliders.
 */
export const RoadMarkers = ({ renderDistance = 340 }: RoadMarkersProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const chunks = useRef(new Map<string, MarkerChunk>()).current;
  const frameCount = useRef(0);

  const geometry = useMemo(() => new THREE.BoxGeometry(0.6, MARKER_HEIGHT, 0.38), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: "#c9a83e" }), []);

  useEffect(() => {
    const group = groupRef.current;
    return () => {
      chunks.forEach((chunk) => {
        chunk.disposed = true;
        if (chunk.mesh && group) group.remove(chunk.mesh);
      });
      chunks.clear();
      geometry.dispose();
      material.dispose();
    };
  }, [chunks, geometry, material]);

  useFrame(({ camera }) => {
    if (frameCount.current++ % UPDATE_INTERVAL_FRAMES !== 0) return;
    const group = groupRef.current;
    if (!group) return;

    const camX = camera.position.x;
    const camZ = camera.position.z;
    const radius = Math.ceil(renderDistance / MARKER_CHUNK_SIZE);
    const ccx = Math.floor(camX / MARKER_CHUNK_SIZE);
    const ccz = Math.floor(camZ / MARKER_CHUNK_SIZE);

    // Build chunks entering range
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const centerX = (cx + 0.5) * MARKER_CHUNK_SIZE;
        const centerZ = (cz + 0.5) * MARKER_CHUNK_SIZE;
        if (Math.hypot(camX - centerX, camZ - centerZ) > renderDistance) continue;

        const key = `${cx}_${cz}`;
        if (chunks.has(key)) continue;

        const entry: MarkerChunk = { mesh: null, disposed: false };
        chunks.set(key, entry);

        markerQueue.addTask(async () => {
          if (entry.disposed) return;
          // Cheap probe: if the chunk center is in another biome AND no biome
          // boundary can reach into the chunk, there is no city road here —
          // skip the full enumeration (keeps far-from-city chunks free).
          const probe = await getVertexData(centerX, centerZ);
          if (
            probe.biomeId !== 1 &&
            probe.distanceToBiomeBoundaryCenter > MARKER_CHUNK_SIZE * 0.75
          )
            return;
          if (entry.disposed) return;
          const points = await getRoadMarkers(
            cx * MARKER_CHUNK_SIZE,
            cz * MARKER_CHUNK_SIZE,
            (cx + 1) * MARKER_CHUNK_SIZE,
            (cz + 1) * MARKER_CHUNK_SIZE,
            STREET_MARKER_SPACING,
            FREEWAY_MARKER_SPACING
          );
          if (entry.disposed || points.length === 0 || !groupRef.current) return;

          const mesh = new THREE.InstancedMesh(geometry, material, points.length);
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          const up = new THREE.Vector3(0, 1, 0);
          const pos = new THREE.Vector3();
          const scale = new THREE.Vector3(1, 1, 1);
          for (let i = 0; i < points.length; i++) {
            const p = points[i];
            // rotateY(θ) maps +X to (cosθ, 0, −sinθ) — align local X with the road
            q.setFromAxisAngle(up, Math.atan2(-p.dirZ, p.dirX));
            pos.set(p.x, p.y + MARKER_HEIGHT * 0.35, p.z); // slightly embedded
            m.compose(pos, q, scale);
            mesh.setMatrixAt(i, m);
          }
          mesh.instanceMatrix.needsUpdate = true;
          // A handful of tiny one-draw-call meshes — skip per-mesh culling
          // (instanced bounds don't auto-fit the scattered instances).
          mesh.frustumCulled = false;
          groupRef.current.add(mesh);
          entry.mesh = mesh;
        });
      }
    }

    // Drop chunks leaving range (hysteresis so borders don't thrash)
    chunks.forEach((entry, key) => {
      const [cx, cz] = key.split("_").map(Number);
      const centerX = (cx + 0.5) * MARKER_CHUNK_SIZE;
      const centerZ = (cz + 0.5) * MARKER_CHUNK_SIZE;
      if (Math.hypot(camX - centerX, camZ - centerZ) > renderDistance * 1.3) {
        entry.disposed = true;
        if (entry.mesh) group.remove(entry.mesh);
        chunks.delete(key);
      }
    });
  });

  return <group ref={groupRef} />;
};
