/** Per region and biome CHANCES by mounting (params.ts pondsOf, index.ts pondKindAt): a region's <Pond> is
 *  every biome's there that does not mount the same kind; a biome's own mount of that kind REPLACES it whole
 *  (a lower or higher chance, `chance={0}` off), other kinds add to it, and a roll picks among them
 *  cumulatively in JSX order. */
import { Biome, Domain, Pond, Region, Rivers, Terrain, Water } from "../../../../world/components";
import { domainConfigOf, domainNodeOf } from "../../../../world/content/config";
import { HOT_SPRING, POND, SPRING } from "../../../../world/domains/overworld/water/spec";
import { DOMAIN_CONFIGS } from "../../../../world/domains";
import { biomeIdOf } from "../../../../world/content/config";
import { setDomainConfig } from "../../computeConfig";
import { initCompute } from "../../vertexCompute";
import { bodyOf } from "../params";
import { bodyWaterColors } from "../material";
import { pondKindAt, pondModeMax } from ".";
import { pondsOf } from "./params";

const TREE = (
  <Domain playerSpawn={[0, 0, 0]}>
    <Terrain seed="pond chances" />
    <Water />
    <Region id={1} name="wet">
      <Rivers chance={0.5} />
      <Pond kind={POND} riverEnd={0.5} />
      <Biome id={2} name="inherits" />
      <Biome id={3} name="lower">
        <Pond kind={POND} riverEnd={0.1} />
      </Biome>
      <Biome id={4} name="off">
        <Pond kind={POND} chance={0} />
      </Biome>
      <Biome id={5} name="higher">
        <Pond kind={POND} riverEnd={0.9} />
      </Biome>
      <Biome id={6} name="both">
        <Pond kind={SPRING} riverEnd={0.3} />
      </Biome>
    </Region>
  </Domain>
);

const chancesIn = (biomeId: number) => pondsOf(biomeId).map((m) => [m.kind.id, m.riverEnd, m.midRiver, m.summit, m.standalone]);

describe("<Pond> chances by region and biome", () => {
  beforeAll(() => initCompute(domainConfigOf(domainNodeOf(TREE))));
  afterAll(() => initCompute(DOMAIN_CONFIGS.overworld));

  it("follow the region's mount where a biome mounts none of that kind", () => {
    expect(chancesIn(2)).toEqual([["pond", 0.5, 0, 0, 0]]);
  });

  it("are replaced whole by a biome's own mount of the same kind: lower, higher or off", () => {
    expect(chancesIn(3)).toEqual([["pond", 0.1, 0, 0, 0]]);
    expect(chancesIn(4)).toEqual([["pond", 0, 0, 0, 0]]);
    expect(chancesIn(5)).toEqual([["pond", 0.9, 0, 0, 0]]);
    for (const u of [0, 0.05, 0.5, 0.95]) expect(pondKindAt(4, "riverEnd", u)).toBeNull();
    expect(pondModeMax("riverEnd")).toBe(0.9);
  });

  it("add up across kinds, the region's first, in JSX order", () => {
    expect(chancesIn(6)).toEqual([
      ["pond", 0.5, 0, 0, 0],
      ["spring", 0.3, 0, 0, 0],
    ]);
    expect(pondKindAt(6, "riverEnd", 0.49)?.kind.id).toBe("pond");
    expect(pondKindAt(6, "riverEnd", 0.79)?.kind.id).toBe("spring");
    expect(pondKindAt(6, "riverEnd", 0.81)).toBeNull();
    expect(pondKindAt(6, "midRiver", 0)).toBeNull();
  });

  it("take `chance` for every mode a mount does not name", () => {
    const node = domainNodeOf(
      <Domain playerSpawn={[0, 0, 0]}>
        <Terrain seed="pond chances" />
        <Water />
        <Region id={1} name="wet">
          <Biome id={2} name="all">
            <Pond kind={HOT_SPRING} chance={0.2} summit={0.6} />
          </Biome>
        </Region>
      </Domain>,
    );
    setDomainConfig(domainConfigOf(node));
    expect(chancesIn(2)).toEqual([["hotSpring", 0.2, 0.2, 0.6, 0.2]]);
  });

  it("in the overworld: the mountain's own plain pond replaces the snow's, its hot spring adds to it", () => {
    setDomainConfig(DOMAIN_CONFIGS.overworld);
    const at = (name: string) => chancesIn(biomeIdOf(DOMAIN_CONFIGS.overworld, name)).map(([kind, riverEnd]) => [kind, riverEnd]);
    expect(at("tundra")).toEqual([["pond", 0.5]]);
    expect(at("mountain")).toEqual([
      ["pond", 0.25],
      ["hotSpring", 0.25],
    ]);
    expect(at("dust")).toEqual([["pond", 0.15]]);
  });

  it("resolve their shape mount → <Water defaults={{ pond }}> → POND_DEFAULTS, and their colours mount → kind", () => {
    const config = domainConfigOf(
      domainNodeOf(
        <Domain playerSpawn={[0, 0, 0]}>
          <Terrain seed="pond shapes" />
          <Water defaults={{ pond: { wallGrade: 0.4, calmGrade: 0.1 } }} />
          <Region id={1} name="wet">
            <Biome id={2} name="all">
              <Pond kind={HOT_SPRING} chance={0.2} calmGrade={0.2} shallowColor="#ff0000" />
              <Pond kind={SPRING} chance={0.2} />
            </Biome>
          </Region>
        </Domain>,
      ),
    );
    setDomainConfig(config);
    const [hot, spring] = pondsOf(2);
    expect([hot.wallGrade, hot.calmGrade, hot.minRadiusOverRiver, hot.wallEase]).toEqual([0.4, 0.2, 2.1, 120]);
    expect([spring.wallGrade, spring.calmGrade]).toEqual([0.4, 0.1]);
    expect(bodyWaterColors(config, bodyOf(2, "pond:hotSpring")).shallowColor).toEqual([1, 0, 0]);
    expect(bodyWaterColors(config, bodyOf(2, "pond:hotSpring")).deepDepth).toBe(6);
    expect(bodyWaterColors(config, bodyOf(2, "pond:spring")).shallowColor).toEqual([0x4f / 255, 0xb4 / 255, 0xa8 / 255]);
    setDomainConfig(DOMAIN_CONFIGS.overworld);
  });
});
