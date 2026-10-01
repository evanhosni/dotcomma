import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { DevContextProvider } from "./context/DevContext";
import { DevOverlay } from "./menus/overlay/DevOverlay";
import { LogsOverlay } from "./menus/overlay/LogsOverlay";
import { NetOverlay } from "./menus/overlay/NetOverlay";
import { startConnection } from "./net/connection";
import "./net/playerData"; // subscribes to the connection (persisted player data)
import "./style.css";
import { CustomCanvas } from "./world/CustomCanvas";
import { DOMAIN_COMPONENTS } from "./world/domains/components";
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
  const DomainComponent = domain && DOMAIN_COMPONENTS[domain];

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
      <CustomCanvas>{DomainComponent && <DomainComponent />}</CustomCanvas>
    </DevContextProvider>
  );
};

root.render(
  <React.StrictMode>
    <Dotcomma />
  </React.StrictMode>,
);
