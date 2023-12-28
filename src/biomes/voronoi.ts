import Delaunator from "delaunator";
import * as THREE from "three";
import { _math } from "../_/math";

export const getVertexData = (x: number, y: number) => {
  const gridSize = 300; //500?
  const roadWidth = 5;
  const currentGrid = [Math.floor(x / gridSize), Math.floor(y / gridSize)];
  var points = [];

  for (let ix = currentGrid[0] - 1; ix <= currentGrid[0] + 1; ix++) {
    for (let iy = currentGrid[1] - 1; iy <= currentGrid[1] + 1; iy++) {
      var pointX = _math.seed_rand(ix + "X" + iy);
      var pointY = _math.seed_rand(ix + "Y" + iy);
      var point = new THREE.Vector3(
        (ix + pointX) * gridSize,
        (iy + pointY) * gridSize,
        0
      );
      points.push(point);
    }
  }

  const delaunay = Delaunator.from(points.map((point) => [point.x, point.y]));

  const circumcenters = [];
  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    const a = points[delaunay.triangles[i]];
    const b = points[delaunay.triangles[i + 1]];
    const c = points[delaunay.triangles[i + 2]];

    const ad = a.x * a.x + a.y * a.y;
    const bd = b.x * b.x + b.y * b.y;
    const cd = c.x * c.x + c.y * c.y;
    const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    const circumcenter = new THREE.Vector3(
      (1 / D) * (ad * (b.y - c.y) + bd * (c.y - a.y) + cd * (a.y - b.y)),
      (1 / D) * (ad * (c.x - b.x) + bd * (a.x - c.x) + cd * (b.x - a.x)),
      0
    );

    circumcenters.push(circumcenter);
  }

  const voronoiWalls = [];
  for (let i = 0; i < delaunay.halfedges.length; i++) {
    const edge = delaunay.halfedges[i];

    if (edge !== -1) {
      const v1 = circumcenters[Math.floor(i / 3)];
      const v2 = circumcenters[Math.floor(edge / 3)];

      if (v1 && v2) voronoiWalls.push(new THREE.Line3(v1, v2));
    }
  }

  var currentVertex = new THREE.Vector3(x, y, 0);

  for (let i = 0; i < voronoiWalls.length; i++) {
    var closestPoint = new THREE.Vector3(0, 0, 0);
    voronoiWalls[i].closestPointToPoint(currentVertex, true, closestPoint);
    if (currentVertex.distanceTo(closestPoint) <= roadWidth) return "road";
  }

  return "block";
};
