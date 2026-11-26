/** The arms an equippable is held with (EquippableSpec.arms). */
export const ARM = { LEFT: "left", RIGHT: "right" } as const;

/** How the arms hold it: AIM points them (and it) where the holder looks; CARRY leaves them to the animation,
 *  the item simply in the hand. */
export const HOLD = { AIM: "aim", CARRY: "carry" } as const;
