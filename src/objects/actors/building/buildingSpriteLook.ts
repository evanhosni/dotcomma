import type { SpriteLook } from "../../sprite-lod/types";
import {
  LIT_WINDOW_COLOR_GLSL,
  nightWindowRollGLSL,
  updateWindowLightUniforms,
  WINDOW_GLOW_COLOR_GLSL,
  WINDOW_LIGHT_UNIFORMS,
} from "./buildingMaterials";
import {
  COLORS_OFFSET,
  GLASS_OFFSET,
  HEIGHTS_OFFSET,
  MAX_PACKED_HEIGHT,
  PATTERN_SEED_OFFSET,
  PROFILE_POINTS,
  VIEW_SAMPLES,
  VIEW_WIDTHS_OFFSET,
  WINDOW_ASPECT,
  WINDOW_BAND_OFFSET,
  WINDOW_COLUMN_PITCH,
  WINDOW_MIX_OFFSET,
  WINDOW_SIZE_OFFSET,
} from "./sprite";

/** How the building sprite (sprite.ts) is drawn; Building.spriteLook. */

const N = PROFILE_POINTS;
const glslFloat = (x: number): string => x.toFixed(4);
const list = (count: number, item: (i: number) => string): string => Array.from({ length: count }, (_, i) => item(i)).join(", ");
const unitPairHigh = (packed: number): string => `spriteUnitPairHigh(spriteDatum(${packed}))`;
const unitPairLow = (packed: number): string => `spriteUnitPairLow(spriteDatum(${packed}))`;
/** The blended widths travel to the fragment as flat vec4s. */
const WIDTH_VECS = Math.ceil(N / 4);
const widthComponent = (j: number): string => `vBuildingWidths${j >> 2}[${j % 4}]`;
/** The silhouette edge's shade, relative to the center. */
const EDGE_SHADE = 0.8;
const WINDOW_GLOW_GAIN = 1.4;
/** The averaged sub-pixel glow's share of the exact one (building/DECISIONS.md 12). */
const FAR_GLOW_DAMPING = 0.35;

const HEADER = /* glsl */ `
  uniform float uWindowLights;
  uniform float uNightSeed;

  float buildingHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

  /** View widths are in the vertex-only data: sample \`view\`, profile height \`point\`. */
  float buildingViewWidth(int view, int point) {
    int q = view * ${N} + point;
    float packed = spriteDatum(${VIEW_WIDTHS_OFFSET} + q / 2);
    return q % 2 == 0 ? spriteUnitPairHigh(packed) : spriteUnitPairLow(packed);
  }

  /** The silhouette's half-width (of the box width) at height y (of the box height), -1 outside it; \`band\`
   *  is the profile height below y (the upper one where two share a height). */
  float buildingHalfWidthAt(float y, float heights[${N}], float widths[${N}], out int band) {
    band = 0;
    float halfWidth = -1.0;
    for (int i = 0; i < ${N - 1}; i++) {
      if (y < heights[i] || y > heights[i + 1]) continue;
      float span = heights[i + 1] - heights[i];
      halfWidth = 0.5 * mix(widths[i], widths[i + 1], span > 0.0 ? (y - heights[i]) / span : 1.0);
      band = i;
    }
    return halfWidth;
  }
`;

// The two nearest sampled views, blended by angle; opposite views are equally wide, so the period is π.
const VERTEX = /* glsl */ `
  float buildingViewT = mod(spriteViewAngle, PI) / (PI / ${VIEW_SAMPLES}.0);
  int buildingView0 = int(buildingViewT) % ${VIEW_SAMPLES};
  int buildingView1 = (buildingView0 + 1) % ${VIEW_SAMPLES};
  float buildingViewMix = fract(buildingViewT);
  float buildingWidths[${N}];
  for (int j = 0; j < ${N}; j++) {
    buildingWidths[j] = mix(buildingViewWidth(buildingView0, j), buildingViewWidth(buildingView1, j), buildingViewMix);
  }
  ${Array.from({ length: N }, (_, j) => `${widthComponent(j)} = buildingWidths[${j}];`).join("\n")}
`;

const FRAGMENT = /* glsl */ `
  float buildingHeights[${N}] = float[${N}](${list(N, (j) => (j % 2 === 0 ? unitPairHigh : unitPairLow)(HEIGHTS_OFFSET + (j >> 1)))});
  float buildingWidths[${N}] = float[${N}](${list(N, widthComponent)});
  int buildingBand;
  float buildingHalf = buildingHalfWidthAt(spriteUv.y, buildingHeights, buildingWidths, buildingBand);
  float buildingX = spriteUv.x - 0.5;
  if (abs(buildingX) > buildingHalf) discard;

  // Darker toward the silhouette edge, so a faceted shell reads as round.
  vec3 buildingWall = spriteUnpackColor(spriteDatum(${COLORS_OFFSET} + buildingBand))
    * mix(1.0, ${EDGE_SHADE}, pow(abs(buildingX) / max(buildingHalf, 1e-4), 2.0));
  vec3 buildingColor = buildingWall;
  float buildingGlow = 0.0;

  float buildingY = spriteUv.y * spriteSize.y;
  float buildingBandBottom = ${unitPairHigh(WINDOW_BAND_OFFSET)} * spriteSize.y;
  float buildingBandTop = ${unitPairLow(WINDOW_BAND_OFFSET)} * spriteSize.y;
  float buildingStory = ${unitPairHigh(WINDOW_SIZE_OFFSET)} * ${glslFloat(MAX_PACKED_HEIGHT)};
  float buildingWindowHeight = ${unitPairLow(WINDOW_SIZE_OFFSET)} * ${glslFloat(MAX_PACKED_HEIGHT)};
  if (buildingWindowHeight > 0.0 && buildingY >= buildingBandBottom && buildingY < buildingBandTop) {
    float rows = max(1.0, floor((buildingBandTop - buildingBandBottom) / buildingStory + 0.5));
    float rowHeight = (buildingBandTop - buildingBandBottom) / rows;
    float row = floor((buildingY - buildingBandBottom) / rowHeight);
    float rowCenter = buildingBandBottom + (row + 0.5) * rowHeight;
    float windowWidth = buildingWindowHeight * ${glslFloat(WINDOW_ASPECT)};
    float pitch = windowWidth * ${glslFloat(WINDOW_COLUMN_PITCH)};
    float x = buildingX * spriteSize.x;
    float column = floor(x / pitch + 0.5);
    int unusedBand;
    float roomBelow = buildingHalfWidthAt((rowCenter - 0.5 * buildingWindowHeight) / spriteSize.y, buildingHeights, buildingWidths, unusedBand);
    float roomAbove = buildingHalfWidthAt((rowCenter + 0.5 * buildingWindowHeight) / spriteSize.y, buildingHeights, buildingWidths, unusedBand);
    bool whole = abs(column * pitch) + 0.5 * windowWidth <= min(roomBelow, roomAbove) * spriteSize.x;
    vec3 cell = vec3(column, row, spriteDatum(${PATTERN_SEED_OFFSET}) * 97.0);
    float fill = ${unitPairHigh(WINDOW_MIX_OFFSET)};
    float chance = ${unitPairLow(WINDOW_MIX_OFFSET)};
    vec3 glass = spriteUnpackColor(spriteDatum(${GLASS_OFFSET}));
    vec3 litColor = ${LIT_WINDOW_COLOR_GLSL};
    float nightOn = step(1e-4, chance) * step(1e-4, uWindowLights);
    vec3 exactColor = buildingWall;
    float exactGlow = 0.0;
    if (whole && buildingHash(cell) < fill) {
      // The real buildings' night rule (buildingMaterials.ts), on a per-cell random.
      float roll = ${nightWindowRollGLSL("buildingHash(cell + 17.0)")};
      float lit = nightOn * step(roll, chance) * step(roll / max(chance, 1e-3), uWindowLights);
      float inWindow = step(abs(x - column * pitch), 0.5 * windowWidth) * step(abs(buildingY - rowCenter), 0.5 * buildingWindowHeight);
      exactColor = mix(buildingWall, mix(glass, litColor, lit), inWindow);
      exactGlow = lit * inWindow;
    }
    // Below ~2px tall the grid's EXPECTED cell (window share × coverage, tonight's lit share), the same for every
    // cell: a per-cell pick at sub-pixel size shimmers as the camera moves. The glow is damped further so a far
    // city at night reads as dark walls with sparse light, not solid yellow blocks (building/DECISIONS.md 12).
    float coverage = fill * windowWidth * buildingWindowHeight / (pitch * rowHeight);
    float litShare = nightOn * chance * clamp(uWindowLights, 0.0, 1.0);
    vec3 averageColor = mix(buildingWall, mix(glass, litColor, litShare), coverage);
    float sharp = clamp(buildingWindowHeight / max(spriteUvPixel.y * spriteSize.y, 1e-6) - 1.0, 0.0, 1.0);
    buildingColor = mix(averageColor, exactColor, sharp);
    buildingGlow = ${WINDOW_GLOW_GAIN} * mix(${FAR_GLOW_DAMPING} * coverage * litShare, exactGlow, sharp);
  }
  diffuseColor.rgb = buildingColor;
`;

export const BUILDING_SPRITE_LOOK: SpriteLook = {
  describer: "building",
  header: HEADER,
  vertex: VERTEX,
  flatVaryings: Array.from({ length: WIDTH_VECS }, (_, k) => `vec4 vBuildingWidths${k}`),
  fragment: FRAGMENT,
  emissive: `totalEmissiveRadiance += ${WINDOW_GLOW_COLOR_GLSL} * buildingGlow;`,
  uniforms: WINDOW_LIGHT_UNIFORMS,
  // Drives the night windows itself: a far skyline can be on screen with no building mounted.
  update: updateWindowLightUniforms,
};
