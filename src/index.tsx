import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { GlitchCity } from "./biomes/glitch-city/GlitchCity";
import { Home } from "./menus/home/Home";
import { PauseMenu } from "./menus/pause/Pause";
import "./style.css";

const root = ReactDOM.createRoot(document.getElementById("dotcomma") as HTMLElement);

const Dotcomma = () => {
  return (
    <BrowserRouter>
      <PauseMenu />
      <Routes>
        <Route index element={<Home />} />
        <Route path="/glitch-city" element={<GlitchCity />} />
        <Route path="*" />
      </Routes>
    </BrowserRouter>
  );
};

root.render(
  <React.StrictMode>
    <Dotcomma />
  </React.StrictMode>
);

//TODO alternative to gh-pages that provides server capabilities.
// You will then be able to uninstall gh-pages npm package and remove predeploy and deploy scripts as well as homepage value in package.json.
