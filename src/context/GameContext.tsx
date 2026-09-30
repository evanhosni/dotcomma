import React, { createContext, ReactNode, useContext, useRef, useState } from "react";
import * as THREE from "three";
import { GameContextType } from "./types";

const GameContext = createContext<GameContextType | undefined>(undefined);

interface GameContextProviderProps {
  children: ReactNode;
}

export const GameContextProvider: React.FC<GameContextProviderProps> = ({ children }) => {
  const playerPositionRef = useRef(new THREE.Vector3(0, 0, 0));
  const [progress, setProgress] = useState(0);
  const [terrainLoaded, setTerrainLoaded] = useState(false);
  const [playerSpawn, setPlayerSpawn] = useState<[number, number, number] | null>(null);

  const value: GameContextType = {
    playerPosition: playerPositionRef.current,
    progress,
    setProgress,
    terrainLoaded,
    setTerrainLoaded,
    playerSpawn,
    setPlayerSpawn,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
};

export const useGameContext = (): GameContextType => {
  const context = useContext(GameContext);

  if (context === undefined) {
    throw new Error("useGameContext must be used within a GameContextProvider");
  }

  return context;
};

export default GameContext;
