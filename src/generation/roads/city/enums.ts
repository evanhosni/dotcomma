// Every road feature is CONFINED to its own cell — that is what guarantees no tiny leftover pieces.
export const CITY_SHAPE_SQUARE = 0;
export const CITY_SHAPE_TRI_NE = 1; // diagonal road from the SW corner to the NE corner
export const CITY_SHAPE_TRI_NW = 2; // diagonal road from the NW corner to the SE corner
export const CITY_SHAPE_CIRCLE = 3;
