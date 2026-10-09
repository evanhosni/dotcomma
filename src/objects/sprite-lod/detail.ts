/**
 * THE HANDOFF CHANNEL between a detailed actor (the writer, actors/Actor.tsx) and its sprite (the reader,
 * SpriteLods.tsx), keyed by spawn-point id. The value is the actor's spawn-fade visibility: its dither keeps
 * the pixels whose Bayer threshold lies below it and the sprite draws exactly the rest, so mid-fade every
 * pixel is drawn once. No report (0) = the actor draws nothing = the sprite is fully shown. Values outlive
 * the sprite buffers, so a report made before a chunk lands applies when it does.
 */

/** Units past the handoff distance a detailed actor holds on before handing off again. */
export const SPRITE_LOD_HYSTERESIS = 20;

type SpriteDetailListener = (id: string, visibility: number) => void;

const details = new Map<string, number>();
let listener: SpriteDetailListener | null = null;

export const setSpriteDetail = (id: string, visibility: number): void => {
  if (visibility > 0) details.set(id, visibility);
  else details.delete(id);
  listener?.(id, visibility);
};

export const spriteDetailOf = (id: string): number => details.get(id) ?? 0;

/** The reader hears each report as it is made (in the actors' frame), so it lands in the same frame's draw.
 *  Returns the unsubscribe. */
export const onSpriteDetail = (next: SpriteDetailListener): (() => void) => {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
};
