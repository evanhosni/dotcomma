import { Dimension } from "../types/Dimension";

export const Spawners = ({ dimension }: { dimension: Dimension }) => {
  const spawners = dimension.getSpawners();

  return (
    <>
      {spawners.map(({ component: Component, coordinates }, index) => {
        return Component ? <Component key={index} coordinates={coordinates} /> : null;
      })}
    </>
  );
};
