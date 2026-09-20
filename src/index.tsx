import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { DevContextProvider } from "./context/DevContext";
import { DevOverlay } from "./menus/overlay/DevOverlay";
import { LogsOverlay } from "./menus/overlay/LogsOverlay";
import { NetOverlay } from "./menus/overlay/NetOverlay";
import { startConnection } from "./net/connection";
import { DayNightLights } from "./lighting/DayNightLights";
import "./style.css";
import { CustomCanvas } from "./world/CustomCanvas";
import { GlitchCityDomain } from "./world/domains/glitch-city/domain";
import { HomeDomain } from "./world/domains/home/domain";
import { getCurrentDomain, initDomainNavigation, onDomainChange } from "./world/domains/navigation";
import { resetDomainSystems } from "./world/domains/reset";
import { DomainId } from "./world/domains/types";

const root = ReactDOM.createRoot(document.getElementById("dotcomma") as HTMLElement);

initDomainNavigation();
startConnection();

/** Swaps the domain inside the ONE persistent canvas in two phases: render
 *  none (the old domain unmounts fully), reset the module-level systems, then
 *  mount the new one. See CLAUDE.md for why this is never a real navigation. */
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
    <DevContextProvider>
      <DevOverlay />
      <LogsOverlay />
      <NetOverlay />
      <CustomCanvas>
        {domain === "glitch-city" && (
          <>
            <DayNightLights />
            <GlitchCityDomain />
          </>
        )}
        {domain === "home" && <HomeDomain />}
      </CustomCanvas>
    </DevContextProvider>
  );
};

root.render(
  <React.StrictMode>
    <Dotcomma />
  </React.StrictMode>,
);
