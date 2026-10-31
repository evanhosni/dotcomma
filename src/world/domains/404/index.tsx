import { DayNightLights } from "../../../lighting/DayNightLights";
import { BEEBLE_SPEC } from "../../../objects/actors/beeble/spec";
import { Actor, Biome, Domain, Material, Region, Skybox, Terrain } from "../../components";
import { FLAT_NOISE } from "../constants";

const WHITE = "#ffffff";

/**
 * Where every unknown path lands ("/404", world/domains/navigation.ts): a flat white void under bright
 * light, drawn as a black wire grid; the sky and the gaps between the wires are the same white. A
 * <Biome> must sit in a <Region>, so it has one of each. Region and biome names are letters only
 * (address words), hence "notfound".
 */
export const NotFoundDomain = (
  <Domain playerSpawn={[0, 0, 0]}>
    <Terrain seed="404" baseNoise={FLAT_NOISE} roadNoise={FLAT_NOISE} wireframe />
    <Skybox color={WHITE} />
    <DayNightLights brightness={2.5} />

    <Region id={0} name="notfound">
      {/* Not 1: the height pipeline's bespoke city branch keys on CITY_BIOME_ID. */}
      <Biome id={4} name="notfound" joinable>
        <Material color="#000000" />
        {/* Rare: about one per 700 × 700u (density is per 1,000,000 sq units). */}
        <Actor actor={BEEBLE_SPEC} density={2} />
      </Biome>
    </Region>
  </Domain>
);
