/**
 * INPUT — what a behavior sees of the mouse, as typed reads over the one-shot
 * flags on its blackboard (raised by useMouseEvents on the client, or from a
 * forwarded action on the server; cleared at the end of the tick).
 *
 * WHO the input belongs to depends on where the machine runs — and that is
 * the whole per-player story:
 *   - on the SERVER (the authority), `ctx.input.leftClick` is true when ANY
 *     player clicked this actor this tick. A transition keyed on it is the
 *     NPC's reaction — world state, seen by everyone.
 *   - on a CLIENT MIRROR (`ctx.groupRef.current` is set), the flags come only
 *     from THIS player's own raycast, so `ctx.input.leftClick` is true only on
 *     the client that clicked. An effect guarded on both is private to the
 *     player who interacted:
 *
 *       onUpdate: (ctx) => {
 *         if (ctx.groupRef.current && ctx.input.leftClick) playSound("you inflated me");
 *       }
 *
 *     while the state the click transitions INTO (its onEnter, its animation)
 *     runs on every client — the inflate everyone sees.
 *
 * The input is visible on the tick it happens, in the state the machine is
 * in at that moment (the click that leaves "alert" is read in "alert").
 */
export class Input {
  constructor(private readonly bb: Record<string, any>) {}

  /** Level: the crosshair is currently on this actor (this client's, or on the server any player's latest hover state). */
  get hovering(): boolean {
    return !!this.bb.__mouse_hover_active;
  }
  get hoverEnter(): boolean {
    return !!this.bb.__mouse_hover_enter;
  }
  get hoverLeave(): boolean {
    return !!this.bb.__mouse_hover_leave;
  }
  get leftClick(): boolean {
    return !!this.bb.__mouse_left_click;
  }
  get rightClick(): boolean {
    return !!this.bb.__mouse_right_click;
  }
  get middleClick(): boolean {
    return !!this.bb.__mouse_middle_click;
  }
  get doubleClick(): boolean {
    return !!this.bb.__mouse_double_click;
  }
  get leftDown(): boolean {
    return !!this.bb.__mouse_left_click_down;
  }
  get leftUp(): boolean {
    return !!this.bb.__mouse_left_click_up;
  }
  get rightDown(): boolean {
    return !!this.bb.__mouse_right_click_down;
  }
  get rightUp(): boolean {
    return !!this.bb.__mouse_right_click_up;
  }
  get scroll(): boolean {
    return !!this.bb.__mouse_scroll;
  }
  get scrollUp(): boolean {
    return !!this.bb.__mouse_scroll_up;
  }
  get scrollDown(): boolean {
    return !!this.bb.__mouse_scroll_down;
  }
}
