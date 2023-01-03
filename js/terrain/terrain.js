import {scene} from "../engine/graphics.js"

function createPlane(colore, x, z) {
  const geometry = new THREE.PlaneGeometry( 1, 1, 50, 5 );
  const material = new THREE.MeshBasicMaterial( {color: colore, side: THREE.DoubleSide, wireframe: false} );
  const plane = new THREE.Mesh( geometry, material );
  scene.add( plane );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -0.5;
  plane.position.x = x;
  plane.position.z = z;
}

createTempPlane()
function createTempPlane() {//temporary. remove later (for fps testing)
  const geo = new THREE.PlaneGeometry( 100, 100, 5, 5 );
  const mat = new THREE.MeshBasicMaterial( {color: '#555', side: THREE.DoubleSide, wireframe: false} );
  const plane2 = new THREE.Mesh( geo, mat );
  scene.add( plane2 );
  plane2.rotation.x = -Math.PI / 2;
  plane2.position.y = -10;
}

var mapSize = 2;
var cellSize = 1;

var TYPES = {
  NONE: 0,
  RESIDENTIAL: 1,
  COMMERCIAL: 2,
  INDUSTRIAL: 3,
  ROAD: 7
}

function RandomRange(min, max) {
  return Math.random() * (max - min) + min;
}

function Cell(i, j) {
  this.i = i;
  this.j = j;
  this.type = TYPES.NONE;
  this.id = -1;
  this.color = "";
}

function shuffle(array) {
  var copy = [],
    n = array.length,
    i;

  // While there remain elements to shuffle…
  while (n) {

    // Pick a remaining element…
    i = Math.floor(Math.random() * array.length);

    // If not already shuffled, move it to the new array.
    if (i in array) {
      copy.push(array[i]);
      delete array[i];
      n--;
    }
  }

  return copy;
}

// Get all cells as a 1 dimensional array
function GetAllCells() {
  var cells = [];
  for (var i = 0; i < mapSize; i++) {
    for (var j = 0; j < mapSize; j++) {
      cells.push(grid[i][j]);
    }
  }
  return cells;
}

function IsInBounds(i, j) {
  return !(i < 0 || i >= mapSize || j < 0 || j >= mapSize);
}

// Hacky code for scalled up version
function IsInBoundsScaled(i, j) {
  return !(i < 0 || i >= mapSize * scaleSize || j < 0 || j >= mapSize * scaleSize);
}

// Check if the neighbor to the right or below is a road and if so replace self as a road cell
function checkIfRoad(i, j) {
  if (IsInBoundsScaled(i + 1, j) && newGrid[i + 1][j].id != newGrid[i][j].id) {
    newGrid[i][j].type = TYPES.ROAD;
  }

  if (IsInBoundsScaled(i, j + 1) && newGrid[i][j + 1].id != newGrid[i][j].id) {
    newGrid[i][j].type = TYPES.ROAD;
  }
}

// Convert type to a color
function getColor(zone) {
  if (zone == TYPES.RESIDENTIAL) {
    return "#00FF00";
  }
  if (zone == TYPES.COMMERCIAL) {
    return "#0000FF";
  }
  if (zone == TYPES.INDUSTRIAL) {
    return "#FF0000";
  }
  if (zone == TYPES.ROAD) {
    return "#303030";
  }
}

// Generate the grid
var grid = [];

for (var i = 0; i < mapSize; i++) {
  grid[i] = [];
  for (var j = 0; j < mapSize; j++) {
    grid[i][j] = new Cell(i, j);
  }
}

// Get a random order to loop through the cells
var checkOrder = shuffle(GetAllCells());

for (var id = 1; id < checkOrder.length; id++) {
  var curTile = checkOrder[id];

  if (curTile.type == TYPES.NONE) {
    var direction = (Math.random() > .5 ? 1 : 0);
    var square_width = RandomRange(2, (direction ? 5 : 2));
    var square_height = RandomRange(2, (direction ? 2 : 5));

    var zones = [TYPES.RESIDENTIAL, TYPES.COMMERCIAL, TYPES.COMMERCIAL, TYPES.RESIDENTIAL, TYPES.INDUSTRIAL];
    var zone = zones[Math.floor(Math.random() * zones.length)];

    for (var i = 0; i < square_width; i++) {
      for (var j = 0; j < square_height; j++) {
        if (IsInBounds(curTile.i + i, curTile.j + j)) {
          grid[curTile.i + i][curTile.j + j].id = id;
          grid[curTile.i + i][curTile.j + j].type = zone;
        }
      }
    }
  }
}

// Part of the algorithm that feels very hacky to me
var scaleSize = 2;
var newGrid = [];
var originalMapping = {
  i: 0,
  j: 0
};

for (var i = 0; i < mapSize * scaleSize; i++) {
  newGrid[i] = [];
  for (var j = 0; j < mapSize * scaleSize; j++) {
    newGrid[i][j] = new Cell(i, j);
    newGrid[i][j].id = grid[originalMapping.i][originalMapping.j].id;
    newGrid[i][j].type = grid[originalMapping.i][originalMapping.j].type;


    if (j % scaleSize == (scaleSize - 1)) {
      originalMapping.j++;
    }
  }

  originalMapping.j = 0;

  if (i % scaleSize == (scaleSize - 1)) {
    originalMapping.i++;
  }
}

// Draw the cells on the canvas
for (var i = 0; i < mapSize * scaleSize; i++) {
  for (var j = 0; j < mapSize * scaleSize; j++) {
    checkIfRoad(i, j);
    createPlane(getColor(newGrid[i][j].type), i * cellSize, j * cellSize)
  }
}
