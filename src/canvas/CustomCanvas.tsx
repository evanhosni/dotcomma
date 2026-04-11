import { Physics } from "@react-three/rapier";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { GameContextProvider, useGameContext } from "../context/GameContext";
import { useDevMode } from "../context/DevContext";
import { Overlay } from "../menus/overlay/Overlay";
import { Player } from "../player/Player";
import { initCursor } from "../utils/cursor/cursor";
import { PostProcessing } from "../vfx/PostProcessing";
import { Terrain } from "../world/terrain/Terrain";
import { ObjectPool } from "../objects/spawning/ObjectPool";
import { PortalContextProvider, usePortalContext } from "../portals/PortalContext";
import { PortalBuilding } from "../portals/PortalBuilding";
import { getIndoorWorldById } from "../portals/worlds/registry";
import { Sky } from "./Sky";

/** Renders the active indoor world as an overlay, if any */
const ActiveIndoorWorld = () => {
  const { activeIndoorId, entryPortalPos } = usePortalContext();
  if (!activeIndoorId) return null;
  const entry = getIndoorWorldById(activeIndoorId);
  if (!entry) return null;
  const IndoorComponent = entry.component;
  return <IndoorComponent entryPortalPos={entryPortalPos.current} />;
};

/** Portal useFrame hooks use non-zero priorities (-1, 1), which disables R3F's
 *  auto-rendering. This component replaces it with an explicit render at the end. */
const SceneRender = () => {
  const { gl, scene, camera } = useThree();
  useFrame(() => {
    gl.render(scene, camera);
  }, 2);
  return null;
};

const PreCustomCanvas = ({ children }: React.PropsWithChildren) => {
  const { terrain_loaded, progress } = useGameContext();
  const { physicsDebug } = useDevMode();

  useEffect(() => {
    initCursor();
  }, []);

  return (
    <>
      <color attach="background" args={["#555555"]} />
      <SceneRender />
      <Overlay />
      <PostProcessing quantization={0.025} />
      <Physics gravity={[0, -100, 0]} debug={physicsDebug}>
        {children}
        {/* Outdoor world — always mounted. Terrain/ObjectPool stay top-level to avoid
            group wrapper issues. PortalBuilding visibility toggles with indoor state. */}
        <Sky />
        <Terrain />
        <ObjectPool />
        <PortalBuilding />
        {/* Indoor world colliders — mount when player enters (visuals are always mounted in PortalBuilding) */}
        <ActiveIndoorWorld />
        <Player />
      </Physics>
    </>
  );
};

/** PreCustomCanvas needs PortalContext, so wrap it */
const PreCustomCanvasWithPortal = ({ children }: React.PropsWithChildren) => (
  <PortalContextProvider>
    <PreCustomCanvas>{children}</PreCustomCanvas>
  </PortalContextProvider>
);

export const CustomCanvas = ({ children }: React.PropsWithChildren) => {
  const defaultCanvasProps = {
    style: { background: "#555" },
  };

  const mergedCanvasProps = { ...defaultCanvasProps };

  return (
    <Canvas {...mergedCanvasProps}>
      <GameContextProvider>
        <PreCustomCanvasWithPortal>{children}</PreCustomCanvasWithPortal>
      </GameContextProvider>
    </Canvas>
  );
};
