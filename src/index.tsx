import { Debug, Physics } from "@react-three/cannon";
import { Canvas } from "@react-three/fiber";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { PauseMenu } from "./PauseMenu";
import { GlitchCity } from "./biomes/glitch-city/GlitchCity";
import { Player } from "./player/Player";
import "./style.css";
import { Terrain } from "./terrain/Terrain";

const root = ReactDOM.createRoot(document.getElementById("dotcomma") as HTMLElement);
const debug = false;

const Dotcomma = () => {
  return (
    <BrowserRouter>
      <PauseMenu />
      <Canvas style={{ background: "#000" }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <Physics>
          <Player />
        </Physics>
        <Physics>
          {debug ? (
            <Debug>
              <Terrain dimension={GlitchCity} />
              <Routes>
                <Route index />
                <Route path="/dust" />
                <Route path="*" />
              </Routes>
            </Debug>
          ) : (
            <>
              <Terrain dimension={GlitchCity} />
              <Routes>
                <Route index />
                <Route path="/dust" />
                <Route path="*" />
              </Routes>
            </>
          )}
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
