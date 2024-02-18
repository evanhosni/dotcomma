import { Debug, Physics } from "@react-three/cannon";
import { Canvas } from "@react-three/fiber";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { PauseMenu } from "./PauseMenu";
import { Player } from "./_/player/Player";
import { Terrain } from "./_/terrain/Terrain";
import { City } from "./biomes/city/City";
import { Dust } from "./biomes/dust/Dust";
import { Pharmasea } from "./biomes/pharma/Pharma";
import "./style.css";

const root = ReactDOM.createRoot(document.getElementById("dotcomma") as HTMLElement);

const Dotcomma = () => {
  return (
    <BrowserRouter>
      <PauseMenu />
      <Canvas style={{ backgroundColor: "gray" }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <Physics>
          <Player />
        </Physics>
        <Physics>
          <Debug>
            <Terrain biomes={[City, Dust, Pharmasea]} />
            <Routes>
              <Route index />
              <Route path="/dust" />
              <Route path="*" />
            </Routes>
          </Debug>
        </Physics>
      </Canvas>
    </BrowserRouter>
  );
};

root.render(
  <React.StrictMode>
    <Dotcomma />
  </React.StrictMode>
);
