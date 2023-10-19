import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { PauseMenu } from "./PauseMenu";
import { Dust } from "./dust/Dust";
import { GlitchCity } from "./glitch-city";
import { Pharma } from "./pharma/Pharma";
import "./style.css";

const root = ReactDOM.createRoot(
  document.getElementById("dotcomma") as HTMLElement
);

root.render(
  <React.StrictMode>
    <Dotcomma />
  </React.StrictMode>
);

function Dotcomma() {
  return (
    <BrowserRouter>
      <PauseMenu />
      <Routes>
        <Route index element={<GlitchCity />} />
        <Route path="dust" element={<Dust />} />
        <Route path="pharma" element={<Pharma />} />
      </Routes>
    </BrowserRouter>
  );
}

export default Dotcomma;