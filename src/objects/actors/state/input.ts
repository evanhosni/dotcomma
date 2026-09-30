/**
 * Typed reads over the one-shot mouse flags on a blackboard. WHO the input belongs
 * to depends on where the machine runs: on the SERVER `leftClick` is true when ANY
 * player clicked (a transition on it is world state); on a CLIENT MIRROR
 * (`ctx.groupRef.current` set) the flags come only from THIS player's raycast, so
 * an effect guarded on both is private to the player who clicked:
 *
 *   if (ctx.groupRef.current && ctx.input.leftClick) playSound("you inflated me");
 *
 * The input is visible on the tick it happens, in the state the machine is in then.
 */
export class Input {
  constructor(private readonly bb: Record<string, any>) {}

  /** Level: the crosshair is on this actor (server: any player's latest hover). */
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
