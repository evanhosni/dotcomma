var canvas = document.getElementById("canvas");
var ctx = canvas.getContext('2d');
ctx.beginPath();

var mapSize = 20;
var cellSize = 20;
var size = mapSize * cellSize;

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

function getRandomColor() {
  var letters = '0123456789ABCDEF';
  var color = '#';
  for (var i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

function Cell(i, j) {
  this.i = i;
  this.j = j;
  this.type = TYPES.NONE;
  this.id = -1;
  this.color = "";
}

function setId(i, j, id) {
  if (i < mapSize && j < mapSize) {
    grid[i][j].id = id;
  }
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

function getNeighbors(i, j) {
  neighbors = [];

  if (IsInBounds(i + 1, j))
    neighbors.push({
      i: i - 1,
      j: j
    });
  if (IsInBounds(i + 1, j))
    neighbors.push({
      i: i + 1,
      j: j
    });
  if (IsInBounds(i, j - 1))
    neighbors.push({
      i: i,
      j: j - 1
    });
  if (IsInBounds(i, j + 1))
    neighbors.push({
      i: i,
      j: j + 1
    });
}

function getType(i, j) {
  return grid[i][j].id % 5;
}

function getCell(i, j) {
  return grid[i][j];
}

function getNeighbors(i, j) {
  var neighbors = [];

  if (IsInBounds(i - 1, j))
    neighbors.push(getCell(i - 1, j));
  if (IsInBounds(i + 1, j))
    neighbors.push(getCell(i + 1, j));
  if (IsInBounds(i, j - 1))
    neighbors.push(getCell(i, j - 1));
  if (IsInBounds(i, j + 1))
    neighbors.push(getCell(i, j + 1));

  return neighbors;
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
    var color = getRandomColor();

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
var num = 0;

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

// Update the size of the canvas
ctx.canvas.width = size * scaleSize;
ctx.canvas.height = size * scaleSize;

// Draw the cells on the canvas
for (var i = 0; i < mapSize * scaleSize; i++) {
  for (var j = 0; j < mapSize * scaleSize; j++) {
    checkIfRoad(i, j);
    ctx.fillStyle = getColor(newGrid[i][j].type);
    ctx.fillRect(i * cellSize, j * cellSize, cellSize, cellSize);
  }
}
