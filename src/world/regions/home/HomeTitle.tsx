import { useEffect, useMemo } from "react";
import { makeLabelMaterial } from "./labelMaterial";

/** The home page title: floating "dotcomma" text — not interactive. */
export const HomeTitle = ({ position }: { position: [number, number, number] }) => {
  const { texture, material } = useMemo(() => makeLabelMaterial("dotcomma"), []);

  useEffect(() => {
    return () => {
      texture.dispose();
      material.dispose();
    };
  }, [texture, material]);

  return (
    <mesh position={position}>
      <planeGeometry args={[7.5, 1.875]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
};
