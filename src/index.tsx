import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { DevContextProvider } from "./context/DevContextProvider";
import { initDevmodeFromUrl } from "./context/utils";
import { DevOverlay } from "./menus/overlay/DevOverlay";
import { LogsOverlay } from "./menus/overlay/LogsOverlay";
import { NetOverlay } from "./menus/overlay/NetOverlay";
import { startConnection } from "./net";
import "./net/store"; // subscribes to the connection (persisted player data)
import "./style.css";
import { CustomCanvas } from "./world/CustomCanvas";
import { DOMAIN_CONFIGS, DOMAIN_TREES } from "./world/domains";
import { getCurrentDomain, initDomainNavigation, onDomainChange } from "./world/domains/navigation";
import { resetDomainSystems } from "./world/domains/utils";
import { IntroOverlay } from "./world/domains/overworld/intro/IntroOverlay";
import { DomainId } from "./world/domains/types";

const root = ReactDOM.createRoot(document.getElementById("dotcomma") as HTMLElement);

initDevmodeFromUrl();
initDomainNavigation(DOMAIN_CONFIGS.overworld.regions);
// The page's title (public/index.html) is the overworld intro's alone.
if (getCurrentDomain() !== "overworld") IntroOverlay.removePageTitle();
startConnection();

/** Swaps the domain inside the ONE persistent canvas in two phases: render
 *  none (the old domain unmounts fully), reset the module-level systems, then
 *  mount the new one. See CLAUDE.md for why this is never a real navigation. */
const Dotcomma = () => {
  const [domain, setDomain] = useState<DomainId | null>(getCurrentDomain());
  const tree = domain && DOMAIN_TREES[domain];

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
      <CustomCanvas>{tree}</CustomCanvas>
    </DevContextProvider>
  );
};

root.render(
  <React.StrictMode>
    <Dotcomma />
  </React.StrictMode>,
);
