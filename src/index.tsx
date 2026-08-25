import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { DevProvider } from "./context/DevContext";
import { DevOverlay } from "./menus/overlay/DevOverlay";
import { LogsOverlay } from "./menus/overlay/LogsOverlay";
import { DayNightLights } from "./lighting/DayNightLights";
import "./style.css";
import { CustomCanvas } from "./world/CustomCanvas";
import { GlitchCityDomain } from "./world/domains/glitch-city/domain";
import { HomeDomain } from "./world/domains/home/domain";
import { getCurrentDomain, initDomainNavigation, onDomainChange } from "./world/domains/navigation";
import { resetDomainSystems } from "./world/domains/reset";
import { DomainId } from "./world/domains/types";

const root = ReactDOM.createRoot(document.getElementById("dotcomma") as HTMLElement);

// Back button/gesture = escape pod, plus the domain-switch listener this
// component subscribes to below. URL paths are FAKE (pushState only) — see
// world/domains/navigation.ts.
initDomainNavigation();

/**
 * ONE page, ONE canvas, one domain at a time — no real routes. The CRT
 * monitor switches domains client-side (switchDomain pushes a fake URL path),
 * and this component swaps the domain INSIDE the persistent <CustomCanvas> in
 * TWO PHASES: render no domain so the outgoing one (its terrain bodies,
 * actors, contexts, all effects) unmounts completely, then reset the
 * module-level domain systems (workers, caches, active-domain accessors —
 * resetDomainSystems), then mount the incoming domain on a clean slate. The
 * canvas itself — GL context, compiled shaders, physics world, Player — is
 * never torn down, so a switch neither loses the context nor recompiles
 * anything. A full page load would do the same job, but it would put a REAL
 * navigation entry in history — and the whole point of the fake paths is that
 * every entry behind the player is same-document, so the back button can only
 * ever fire popstate (the escape pod), never unload the game.
 */
const Dotcomma = () => {
  const [domain, setDomain] = useState<DomainId | null>(getCurrentDomain());

  useEffect(() => onDomainChange(() => setDomain(null)), []);
  useEffect(() => {
    if (domain === null) {
      resetDomainSystems();
      setDomain(getCurrentDomain());
    }
  }, [domain]);

  return (
    <DevProvider>
      <DevOverlay />
      <LogsOverlay />
      <CustomCanvas>
        {domain === "glitch-city" && (
          <>
            <DayNightLights />
            <GlitchCityDomain />
          </>
        )}
        {domain === "home" && <HomeDomain />}
      </CustomCanvas>
    </DevProvider>
  );
};

root.render(
  <React.StrictMode>
    <Dotcomma />
  </React.StrictMode>,
);
//TODO alternative to gh-pages that provides server capabilities.
// You will then be able to uninstall gh-pages npm package and remove predeploy and deploy scripts as well as homepage value in package.json.
