import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { NotFound } from "./404/NotFound";
import { PauseMenu } from "./PauseMenu";
import { Biomes } from "./biomes";
import "./style.css";

const root = ReactDOM.createRoot(
  document.getElementById("dotcomma") as HTMLElement
);

const Dotcomma = () => {
  return (
    <BrowserRouter>
      <PauseMenu />
      <Routes>
        <Route index element={<Biomes />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

root.render(
  <React.StrictMode>
    <Dotcomma />
  </React.StrictMode>
);
