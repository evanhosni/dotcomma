import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DevProvider } from "./context/DevContext";
import { DevOverlay } from "./menus/overlay/DevOverlay";
import { LogsOverlay } from "./menus/overlay/LogsOverlay";
import { DayNightLights } from "./sky/DayNightLights";
import "./style.css";
import { CustomCanvas } from "./world/CustomCanvas";
import { GlitchCityWorld } from "./world/GlitchCityWorld";
import { HomeWorld } from "./world/HomeWorld";

const root = ReactDOM.createRoot(document.getElementById("dotcomma") as HTMLElement);

/**
 * One route per world. Navigation BETWEEN worlds is a full page load (the
 * in-world link uses window.location) — workers and the world registry are
 * initialized once per page load, so client-side world switches would leave
 * the terrain/spawn workers running on the previous world's config.
 */
const Dotcomma = () => {
  return (
    <BrowserRouter>
      <DevProvider>
        <DevOverlay />
        <LogsOverlay />
        <Routes>
          <Route
            path="/glitch-city"
            element={
              <CustomCanvas>
                <DayNightLights />
                <GlitchCityWorld />
              </CustomCanvas>
            }
          />
          <Route
            path="*"
            element={
              // Home terrain is flat at height 0 — spawn standing at the origin
              <CustomCanvas background="#000000" playerSpawn={[0, 0, 0]}>
                <HomeWorld />
              </CustomCanvas>
            }
          />
        </Routes>
      </DevProvider>
    </BrowserRouter>
  );
};

root.render(
  <React.StrictMode>
    <Dotcomma />
  </React.StrictMode>,
);
//TODO alternative to gh-pages that provides server capabilities.
// You will then be able to uninstall gh-pages npm package and remove predeploy and deploy scripts as well as homepage value in package.json.
