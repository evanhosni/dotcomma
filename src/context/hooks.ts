import { useContext } from "react";
import { DevContextType, GameContextType } from "./types";
import { DevContext } from "./DevContextProvider";
import { GameContext } from "./GameContextProvider";

export const useDevContext = (): DevContextType => {
  const context = useContext(DevContext);

  if (context === undefined) {
    throw new Error("useDevContext must be used within a DevContextProvider");
  }

  return context;
};

export const useGameContext = (): GameContextType => {
  const context = useContext(GameContext);

  if (context === undefined) {
    throw new Error("useGameContext must be used within a GameContextProvider");
  }

  return context;
};
