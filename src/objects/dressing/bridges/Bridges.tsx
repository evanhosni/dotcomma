import * as THREE from "three";
import { BRIDGE_PIER_SIZE, BRIDGES_SPEC, bridgePierColumns, bridgeRibbon, type BridgeRibbonBuffers } from "./bridgeSpec";
import {
  DressingPartColliders,
  finalizeInstancedChunk,
  useChunkRegistry,
  useDressingAssets,
  useDressingChunks,
  useDressingColliders,
  useDressingDefault,
  type ChunkWithPoints,
} from "../Dressing";
import { DressingAttributes } from "../../types";
import { enumerateDressing } from "../dressingWorker";
import { uploadOnFirstDraw } from "../../../utils/uploadOnFirstDraw";
import { WORLD_WRAP } from "../../../world/shaders/constants";
import { createDeckMaterial } from "./deckMaterial";

const BRIDGE_RENDER_DISTANCE = 900;
/** Deck chords are one body each (~6u), so the walkable deck is solid only near the player. */
const BRIDGE_COLLIDER_DISTANCE = 140;

export interface BridgesProps extends DressingAttributes {}

/** Decks over every road a river crosses (placement: getFreewayBridges in the dressing worker).
 *  Per chunk: ONE merged ribbon mesh for every deck, one instanced mesh of pier columns, and the
 *  deck chords' pitched colliders. */
export const Bridges = ({ renderDistance, colliderDistance }: BridgesProps) => {
  const resolvedDistance = useDressingDefault("renderDistance", renderDistance, BRIDGE_RENDER_DISTANCE);
  const resolvedColliderDistance = useDressingDefault("colliderDistance", colliderDistance, BRIDGE_COLLIDER_DISTANCE);
  const registry = useChunkRegistry<ChunkWithPoints>();

  const assets = useDressingAssets(() => ({
    deckMaterial: createDeckMaterial(),
    pierMaterial: new THREE.MeshStandardMaterial({ color: 0x7c7c78, roughness: 0.95, metalness: 0 }),
    pierGeometry: new THREE.BoxGeometry(1, 1, 1),
  }));

  const groupRef = useDressingChunks({
    renderDistance: resolvedDistance,
    build: async (bounds) => {
      const decks = await enumerateDressing(BRIDGES_SPEC.enumerator, bounds, BRIDGES_SPEC.placement);
      if (decks.length === 0) return null;
      const group = new THREE.Group();

      // The ribbon is stored relative to a float64 chunk origin (CLAUDE.md → Coordinate Precision).
      const ox = (bounds.minX + bounds.maxX) / 2;
      const oz = (bounds.minZ + bounds.maxZ) / 2;
      const oy = decks.reduce((sum, b) => sum + b.sy, 0) / decks.length;
      // The road texture's uv origin: a WORLD_WRAP multiple (a whole number of tiles), so its phase is the terrain's.
      const uvx = Math.floor(ox / WORLD_WRAP) * WORLD_WRAP;
      const uvz = Math.floor(oz / WORLD_WRAP) * WORLD_WRAP;
      const buffers: BridgeRibbonBuffers = { positions: [], normals: [], colors: [], uvs: [], road: [] };
      for (const b of decks) bridgeRibbon(b, ox, oy, oz, uvx, uvz, buffers);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buffers.positions), 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(buffers.normals), 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(buffers.colors), 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(buffers.uvs), 2));
      geometry.setAttribute("road", new THREE.BufferAttribute(new Float32Array(buffers.road), 4));
      geometry.computeBoundingSphere();
      const deck = new THREE.Mesh(geometry, assets.deckMaterial);
      deck.position.set(ox, oy, oz);
      deck.userData.ownsGeometry = true;
      uploadOnFirstDraw(deck);
      group.add(deck);

      const columns = decks.flatMap(bridgePierColumns);
      if (columns.length > 0) {
        const piers = new THREE.InstancedMesh(assets.pierGeometry, assets.pierMaterial, columns.length);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const pos = new THREE.Vector3();
        const scale = new THREE.Vector3();
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        columns.forEach((c, i) => {
          pos.set(c.x, (c.topY + c.groundY) / 2, c.z);
          scale.set(BRIDGE_PIER_SIZE, c.topY - c.groundY, BRIDGE_PIER_SIZE);
          m.compose(pos, q, scale);
          piers.setMatrixAt(i, m);
          minX = Math.min(minX, c.x);
          maxX = Math.max(maxX, c.x);
          minZ = Math.min(minZ, c.z);
          maxZ = Math.max(maxZ, c.z);
          minY = Math.min(minY, c.groundY);
          maxY = Math.max(maxY, c.topY);
        });
        finalizeInstancedChunk(piers, minX, minY, minZ, maxX, maxY, maxZ, BRIDGE_PIER_SIZE);
        group.add(piers);
      }

      registry.add({ group, points: decks.flatMap(BRIDGES_SPEC.bodiesOf) });
      return group;
    },
  });

  const colliders = useDressingColliders(registry, { colliderDistance: resolvedColliderDistance });

  return (
    <>
      <group ref={groupRef} />
      <DressingPartColliders colliders={colliders} parts={BRIDGES_SPEC.colliderParts} />
    </>
  );
};
