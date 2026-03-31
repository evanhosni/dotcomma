import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { CustomCanvas } from "./canvas/CustomCanvas";
import { DevProvider } from "./context/DevContext";
import { DevOverlay } from "./menus/overlay/DevOverlay";
import { LogsOverlay } from "./menus/overlay/LogsOverlay";
import "./style.css";

const root = ReactDOM.createRoot(document.getElementById("dotcomma") as HTMLElement);

const Dotcomma = () => {
  return (
    <BrowserRouter>
      <DevProvider>
        <DevOverlay />
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
