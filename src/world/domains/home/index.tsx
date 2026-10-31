import { Biome, Domain, Material, Region, Skybox, Terrain } from "../../components";
import { FLAT_NOISE } from "../constants";
import { CrtMonitor } from "./crt";
import { CRT_POSITION } from "./crt/constants";
import { crtLitGridMaterial } from "./crt/material";
import { HomeScreen } from "./HomeScreen";
import { HomeTitle } from "./HomeTitle";

/** The landing page (path "/"): a flat black world, its wire grid lit only by the CRT's glow once it powers on. */
export const HomeDomain = (
  <Domain playerSpawn={[0, 0, 0]}>
    <Terrain seed="home" baseNoise={FLAT_NOISE} roadNoise={FLAT_NOISE} wireframe />
    <Skybox color="#000000" />

    <Region id={0} name="home">
      <Biome id={4} name="wire" joinable>
        <Material getMaterial={crtLitGridMaterial} />
      </Biome>
    </Region>

    <CrtMonitor position={CRT_POSITION} />
    <HomeTitle position={[0, 4, -10]} />
    <HomeScreen />
  </Domain>
);
