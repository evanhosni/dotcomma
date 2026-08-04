export interface GrassFieldProps {
  density?: number; // blades per 1,000,000 sq units (same scale as SpawnDescriptor.density). Default 800,000
  biomeIds?: number[]; // restrict to specific biomes
  heightRange?: [number, number]; // restrict to height band
  slopeRange?: [number, number]; // restrict to slope range (degrees). Default [0, 35]
  slopeBlend?: number; // degrees over which density fades and blades shorten at the slopeRange edges. Default 10
  color?: string; // tint multiplied over the texture. Default "#6a9c45" (pass "#fff" to keep a custom png's colors)
  png?: string; // optional billboard texture path (alpha-tested); default is a procedurally drawn grass blade
  bladeWidth?: number; // world units. Default 0.12
  bladeHeight?: number; // world units. Default 1.2
  sway?: number; // max tip displacement in world units — 0 disables sway. Default 0.15
  swaySpeed?: number; // wind animation speed multiplier. Default 1.2
  renderDistance?: number; // max camera distance; blades shrink out near the edge. Default 120
  seed?: string; // deterministic placement seed — vary to decorrelate multiple GrassFields. Default "grass"
  quantization?: number; // vertex quantization grid size for this field; defaults to the global grid
}
