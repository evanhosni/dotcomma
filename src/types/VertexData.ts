export interface VertexData {
  x: number;
  y: number;
  height: number;
  attributes: any; //TODO save attributes for only shader related attributes?
}

export const vertexData_default: VertexData = {
  x: 0,
  y: 0,
  height: 0,
  attributes: {},
};
