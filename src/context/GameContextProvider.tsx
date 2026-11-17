import React from "react";
import { createContext, ReactNode, useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { GameContextType } from "./types";

export const GameContext = createContext<GameContextType | undefined>(undefined);

interface GameContextProviderProps {
  children: ReactNode;
}

export const GameContextProvider: React.FC<GameContextProviderProps> = ({ children }) => {
  const playerPositionRef = useRef(new THREE.Vector3(0, 0, 0));
  const [progress, setProgress] = useState(0);
  const [terrainLoaded, setTerrainLoaded] = useState(false);
  const [playerSpawn, setSpawn] = useState<[number, number, number] | null>(null);
  const [spawnDropHeight, setSpawnDropHeight] = useState<number | null>(null);
  const setPlayerSpawn = useCallback((spawn: [number, number, number] | null, dropHeight: number | null = null) => {
    setSpawn(spawn);
    setSpawnDropHeight(dropHeight);
  }, []);

  const value: GameContextType = {
    playerPosition: playerPositionRef.current,
    progress,
    setProgress,
    terrainLoaded,
    setTerrainLoaded,
    playerSpawn,
    spawnDropHeight,
    setPlayerSpawn,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
};
