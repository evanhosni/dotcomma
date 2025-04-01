import React, { createContext, ReactNode, useContext, useState } from "react";
import * as THREE from "three";
import { Chunk } from "../world/terrain/types";
import { GameContextType } from "./types";

// Create the context with a default value
const GameContext = createContext<GameContextType | undefined>(undefined);

// Props for the provider component
interface GameContextProviderProps {
  children: ReactNode;
}

// Create a provider component
export const GameContextProvider: React.FC<GameContextProviderProps> = ({ children }) => {
  const [playerPosition, setPlayerPosition] = useState<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const [chunks, setChunks] = useState<{ [key: string]: { position: number[]; chunk: Chunk } }>({});

  // Value object to be provided to consumers
  const value: GameContextType = {
    playerPosition,
    setPlayerPosition,
    chunks,
    setChunks,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
};

// Custom hook for using the context
export const useGameContext = (): GameContextType => {
  const context = useContext(GameContext);

  if (context === undefined) {
    throw new Error("useGame must be used within a GameContextProvider");
  }

  return context;
};

// Export the context itself in case someone needs direct access
export default GameContext;
