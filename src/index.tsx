import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { PauseMenu } from "./PauseMenu";
import { NotFound } from "./biomes/404/NotFound";
import { City } from "./biomes/city/City";
import { Dust } from "./biomes/dust/Dust";
import "./style.css";

const root = ReactDOM.createRoot(
  document.getElementById("dotcomma") as HTMLElement
);

const Dotcomma = () => {
  return (
    <BrowserRouter>
      <PauseMenu />
      <Routes>
        <Route index element={<City />} />
        <Route path="/dust" element={<Dust />} />
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
