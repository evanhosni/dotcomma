/** Piece codes: built, or the reason it is not. */
export const PIECE_BUILT = 0;
export const PIECE_WATER = 1;
export const PIECE_HIGH = 2;
export const PIECE_MOUNTAIN = 3;
export const PIECE_ROAD = 4;
export const PIECE_GORGE = 5;
/** In a DRY biome (`<Rivers chance={0}>`): final — never gap-filled, gorged or built by any later layer. */
export const PIECE_DRY = 6;
/** On a summit connection's climb (generation/water/rivers/ponds/index.ts): built, its water falling away from the summit pond. */
export const PIECE_CLIMB = 7;
export const pieceBuilt = (code: number): boolean => code === PIECE_BUILT || code === PIECE_GORGE || code === PIECE_CLIMB;
