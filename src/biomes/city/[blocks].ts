import * as THREE from "three";
import { VertexData } from "../../types/VertexData";
import { ArcticProperties } from "../arctic/Arctic";
import { DustProperties } from "../dust/Dust";
import { PharmaProperties } from "../pharma/Pharma";
import { StaticProperties } from "../static/Static";

export const blocks: any[] = [
  {
    name: "city",
    height: 5,
    params: {
      difficulty: 0,
    },
    roadWidth: 20,
    roadVary: 0,
    blendWidth: 50,
    blendVary: 0.2,
    // getHeight: (vertexData: VertexData) => CityProperties.getHeight(vertexData),
    color: new THREE.Color(0.2, 0.8, 0.2),
  },
  {
    name: "dust",
    height: 20,
    params: {
      difficulty: 6,
    },
    roadWidth: 30,
    roadVary: 0.6,
    blendWidth: 80,
    blendVary: 0.8,
    getHeight: (vertexData: VertexData) => DustProperties.getHeight(vertexData),
    color: new THREE.Color(0.8, 0.2, 0.2),
    fragShader: DustProperties.fragShader,
  },
  {
    name: "pharma",
    height: 10,
    params: {
      difficulty: 4,
    },
    roadWidth: 30,
    roadVary: 0.6,
    blendWidth: 80,
    blendVary: 0.8,
    getHeight: (vertexData: VertexData) =>
      PharmaProperties.getHeight(vertexData),
    color: new THREE.Color(0.2, 0.2, 0.8),
    fragShader: PharmaProperties.fragShader,
  },
  {
    name: "arctic",
    height: 30,
    params: {
      difficulty: 7,
    },
    roadWidth: 30,
    roadVary: 0.6,
    blendWidth: 80,
    blendVary: 0.8,
    getHeight: (vertexData: VertexData) =>
      ArcticProperties.getHeight(vertexData),
    color: new THREE.Color(0.2, 0.8, 0.8),
    fragShader: ArcticProperties.fragShader,
  },
  {
    name: "static",
    height: 30,
    params: {
      difficulty: 9,
    },
    roadWidth: 30,
    roadVary: 0.6,
    blendWidth: 80,
    blendVary: 0.8,
    getHeight: (vertexData: VertexData) =>
      StaticProperties.getHeight(vertexData),
    color: new THREE.Color(0.5, 0.5, 0.5),
    fragShader: StaticProperties.fragShader,
  },
];
