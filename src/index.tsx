import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { CustomCanvas } from "./canvas/CustomCanvas";
import { UrlParametersProvider } from "./context/UrlParametersContext";
import { CommandPalette } from "./menus/command-palette/CommandPalette";
import { LogsOverlay } from "./menus/overlay/LogsOverlay";
import "./style.css";

const root = ReactDOM.createRoot(document.getElementById("dotcomma") as HTMLElement);

const Dotcomma = () => {
  return (
    <BrowserRouter>
      <UrlParametersProvider>
        <CommandPalette />
        <LogsOverlay />
        <Routes>
          <Route
            index
            element={
              <CustomCanvas>
                <ambientLight intensity={0.5} />
                <directionalLight position={[10, 10, 5]} intensity={1} />
              </CustomCanvas>
            }
          />
          <Route path="*" />
        </Routes>
      </UrlParametersProvider>
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
