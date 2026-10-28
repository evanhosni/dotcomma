import { Domain } from "../components/Domain";
import { domainConfigOf, domainNodeOf } from "./config";
import { DOMAIN_NODES, DOMAIN_TREES } from "../domains";
import { childrenOfKind } from "./index";
import { actorPlacementsOf } from "./config";
import { featurePlacesIn } from "../../utils/workers/featurePlacement";
import { nodeOf, readContent } from "./index";

/** The tree is read two ways — by the walker from the root element (the server), and by <Domain>'s
 *  own View from its children (the client). They must produce the same world. */
describe("the content tree", () => {
  it("reads the same from the root element and from inside <Domain>", () => {
    for (const [id, tree] of Object.entries(DOMAIN_TREES)) {
      const fromRoot = domainNodeOf(tree);
      const fromInside = nodeOf(Domain.content, {}, tree.props.children);
      expect(domainConfigOf(fromInside)).toEqual(domainConfigOf(fromRoot));
      expect(fromInside.children.map((c) => c.kind)).toEqual(fromRoot.children.map((c) => c.kind));
      expect(fromRoot.children.filter((c) => c.kind === "region").length).toBeGreaterThan(0);
      expect(id).toBeTruthy();
    }
  });

  it("walks past views and host elements to the declarations inside them", () => {
    const overworld = domainNodeOf(DOMAIN_TREES.overworld);
    const regions = overworld.children.filter((c) => c.kind === "region");
    expect(regions.map((r) => r.props.name)).toEqual(["city", "desert", "snow", "ocean"]);
    const city = regions[0].children.filter((c) => c.kind === "biome");
    expect(city.map((b) => b.props.name)).toEqual(["city", "grass"]);
  });

  it("gives every biome the features mounted in it, and nothing else", () => {
    const config = domainConfigOf(domainNodeOf(DOMAIN_TREES.overworld));
    const features = Object.fromEntries(
      config.regions.flatMap((r) => r.biomes.map((b) => [b.name, Object.keys(b.features).sort()])),
    );
    expect(features.city).toEqual(["bridges", "freewayLamps", "powerLines", "roadMarkers", "sewers", "streetLamps", "trafficLights"]);
    expect(features.mountain).toEqual(["caves", "riverBanks", "rocks", "snow"]);
    expect(features.tundra).toEqual(["rocks", "snow"]);
    expect(features.lake).toEqual(["lakeBubbles", "water"]);
    expect(features.dust).toEqual([]);
  });

  it("gives a region rivers only where <Rivers> is mounted", () => {
    const overworld = domainConfigOf(domainNodeOf(DOMAIN_TREES.overworld));
    expect(Object.fromEntries(overworld.regions.map((r) => [r.name, r.riverProbability]))).toEqual({
      city: 0.35,
      desert: 0.15,
      snow: 0.55,
      ocean: 0.6,
    });
    // The home page mounts none, so it has none — there is no domain-level fallback.
    const home = domainConfigOf(domainNodeOf(DOMAIN_TREES.home));
    expect(home.regions.map((r) => r.riverProbability)).toEqual([0]);
  });

  it("derives prohibitRoads from <Water>, never from a flag beside it", () => {
    const config = domainConfigOf(domainNodeOf(DOMAIN_TREES.overworld));
    for (const region of config.regions) {
      for (const biome of region.biomes) expect(biome.prohibitRoads).toBe(!!biome.water);
    }
  });

  it("memoizes a walk, so a re-render never re-reads the world", () => {
    expect(readContent(DOMAIN_TREES.overworld)).toBe(readContent(DOMAIN_TREES.overworld));
  });

  it("every feature-placed <Actor> has a placement the spawn worker can find", () => {
    // The worker runs on a SERIALIZED config, so an actor inside a feature reaches its placement by
    // PATH through a table (utils/workers/featurePlacement.ts). Nothing types that link, so pin it.
    for (const domain of Object.values(DOMAIN_NODES)) {
      for (const region of childrenOfKind(domain, "region")) {
        for (const biome of childrenOfKind(region, "biome")) {
          for (const { feature } of actorPlacementsOf(biome)) {
            if (!feature) continue;
            expect(() => featurePlacesIn(feature, 0, { minX: 0, minZ: 0, maxX: 1, maxZ: 1 })).not.toThrow();
          }
        }
      }
    }
  });
});
