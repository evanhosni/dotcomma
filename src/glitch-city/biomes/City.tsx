import { Component } from "react";
import { _noise, TerrainNoiseParams } from "../../_/noise";

const noise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 2,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 10,
  scale: 8,
};

export class City extends Component {
  static getHeight(x: number, y: number) {
    return _noise.terrain(noise, x, y);
  }

  render() {
    return <></>;
  }
}
