import { VertexData } from "../../../types/VertexData";

export const getHeight = (vertexData: VertexData) => {
  if (vertexData.attributes.isRoad) return -5;

  let height = 0;

  if (vertexData.blendData.length === 0) {
    return 20; //vertexData.block.getHeight(vertexData);
  }

  for (let i = 0; i < vertexData.blendData.length; i++) {
    height +=
      20 /*vertexData.blendData[i].block.getHeight(vertexData) */ *
      vertexData.blendData[i].value;
  }

  return height;
};
