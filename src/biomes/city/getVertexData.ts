import { _city } from "../../_/_city";
import { VertexData } from "../../types/VertexData";
import { blocks } from "./blocks/[blocks]";

export const gridSize = 100; //NOTE with GRID_SIZE 100 and ROAD_WIDTH 10, blocks are 80x80 and buildings should be like...50x50
export const roadWidth = 10;

export const getVertexData = (vertexData: VertexData) => {
  const { current, distanceToRoadCenter } = _city.create({
    seed: "city1",
    vertexData,
    gridSize,
    blocks,
  });

  vertexData.attributes.isEdgeBlock = current.isEdge;
  vertexData.attributes.block = current.block;
  vertexData.attributes.distanceToRoadCenter = distanceToRoadCenter;

  vertexData.height = getHeight(vertexData);

  // if (Object.values(include).every((inc) => !inc)) {
  //   console.log("this is where a big arena or something could be", current.point); //TODO add big arena sized blocks
  // }

  return vertexData;
};

const getHeight = (vertexData: VertexData) => {
  let height = 0;

  if (vertexData.attributes.distanceToRoadCenter > roadWidth) {
    height = 1;
  }

  return height;
};
