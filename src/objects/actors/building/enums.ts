export enum WINDOW_SHAPE {
  CIRCLE = "circle",
  SQUARE = "square",
}

/** Generation knobs; anything unset is seeded-random per building. Array
 *  knobs are CHOICES, one picked per building (or per floor for roomCount). */
export enum LIGHT_TYPE {
  /** Flat fluorescent rectangles on a grid across the whole ceiling. */
  PANEL = "panel",
  /** Round dome fixtures, one to three per room. */
  DOME = "dome",
}

export enum ROOF_STYLE {
  /** Lofted segments that lean, taper and lip, topped by caps and pipes. */
  FLAT = "flat",
  /** A house: straight walls under an overhanging hip roof, windows on every floor. */
  PITCHED = "pitched",
}
