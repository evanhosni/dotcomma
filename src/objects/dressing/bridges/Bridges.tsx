import * as THREE from "three";
import {
  BRIDGE_PIER_SIZE,
  BRIDGES_SPEC,
  bridgePierColumns,
  bridgeRibbon,
  type BridgePierColumn,
  type BridgeRibbonBuffers,
} from "./bridgeSpec";
import { finalizeInstancedChunk, useDressingAssets, useSolidDressing } from "../Dressing";
import type { DressingBounds } from "../types";
import { DressingAttributes } from "../../types";
import type { FreewayBridge } from "../../../utils/workers/vertexCompute";
import { uploadOnFirstDraw } from "../../../utils/uploadOnFirstDraw";
import { instancedTemplate, meshTemplate } from "../../../utils/warmPrograms";
import { WORLD_WRAP } from "../../../world/shaders/constants";
import { createDeckMaterial } from "./deckMaterial";

const BRIDGE_RENDER_DISTANCE = 900;
/** Deck chords are one body each (~6u), so the walkable deck is solid only near the player. */
const BRIDGE_COLLIDER_DISTANCE = 140;

/** ONE merged ribbon mesh for every deck of the chunk, stored relative to a float64 chunk origin
 *  (CLAUDE.md → Coordinate Precision). */
const buildDeckRibbonMesh = (decks: FreewayBridge[], bounds: DressingBounds, material: THREE.Material): THREE.Mesh => {
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
  const deck = new THREE.Mesh(geometry, material);
  deck.position.set(ox, oy, oz);
  deck.userData.ownsGeometry = true;
  uploadOnFirstDraw(deck);
  return deck;
};

/** One instanced unit box per pier column, stretched from the ground to the deck's underside. */
const buildPierMesh = (columns: BridgePierColumn[], geometry: THREE.BufferGeometry, material: THREE.Material): THREE.InstancedMesh => {
  const piers = new THREE.InstancedMesh(geometry, material, columns.length);
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
  return piers;
};

/** Placement lives in bridgeSpec.ts only (the terrain cut and the server read it). */
export interface BridgesProps extends Pick<DressingAttributes, "renderDistance" | "colliderDistance"> {}

/** Decks over every road a river crosses (placement: getFreewayBridges in the dressing worker).
 *  Per chunk: ONE merged ribbon mesh for every deck, one instanced mesh of pier columns, and the
 *  deck chords' pitched colliders. */
export const Bridges = ({ renderDistance, colliderDistance }: BridgesProps) => {
  const assets = useDressingAssets(() => ({
    deckMaterial: createDeckMaterial(),
    pierMaterial: new THREE.MeshStandardMaterial({ color: 0x7c7c78, roughness: 0.95, metalness: 0 }),
    pierGeometry: new THREE.BoxGeometry(1, 1, 1),
  }), (a) => [meshTemplate(a.deckMaterial), instancedTemplate(a.pierMaterial)]);

  const { content } = useSolidDressing(BRIDGES_SPEC, {
    renderDistance,
    defaultRenderDistance: BRIDGE_RENDER_DISTANCE,
    colliderDistance,
    defaultColliderDistance: BRIDGE_COLLIDER_DISTANCE,
    build: (decks, _bodies, bounds) => {
      const group = new THREE.Group();
      group.add(buildDeckRibbonMesh(decks, bounds, assets.deckMaterial));
      const columns = decks.flatMap(bridgePierColumns);
      if (columns.length > 0) group.add(buildPierMesh(columns, assets.pierGeometry, assets.pierMaterial));
      return { group };
    },
  });

  return content;
};
