import { FONT, HUD_Z_INDEX } from "../../../../menus/overlay/constants";
import { LABEL_CANVAS_WIDTH, LABEL_MIDDLE_LIFT, PROMPT_ENTER, PROMPT_FONT_PX, PROMPT_WIDTH, TITLE_ABOVE_CENTER, TITLE_DEPTH, TITLE_FONT_PX, TITLE_WIDTH } from "./constants";

/** How soft the eyelids' edges are (px). */
const LID_FEATHER = 60;

/** The page's own title (public/index.html): there before any script has run. */
const TITLE_ID = "intro-title";
const NAME_ID = "intro-title-name";
const PROMPT_ID = "intro-title-prompt";

/**
 * The intro's page layer, over the canvas: the TITLE, a black that fades the screen out, and two eyelids
 * that close the view from the top and the bottom. Built like the other overlays (menus/overlay), one under
 * the HUD column so the devmode panel stays usable above it.
 *
 * The title is public/index.html's own markup, on screen the moment the page loads, while the bundle, the
 * canvas and the world are still loading. It is an exact copy of the sky title the unit hovers over
 * (`layoutTitle`: the same type sizes and places, as the camera sees the sky's), black around it, and it
 * stays over the canvas, taking the click, until the fall starts: then it is removed and the sky's own title
 * (drawn behind it all along, so its programs are linked) zooms past. A click before the game is up is kept
 * ("- loading -", by the page's own script) and taken once it is.
 */
export class IntroOverlay {
  /** Called once at boot outside the overworld: the page's title belongs to the overworld's intro alone. */
  static removePageTitle(): void {
    document.getElementById(TITLE_ID)?.remove();
  }

  private readonly root = document.createElement("div");
  private readonly black = document.createElement("div");
  private readonly upperLid = document.createElement("div");
  private readonly lowerLid = document.createElement("div");
  private readonly title: HTMLElement;
  private readonly name: HTMLElement;
  private readonly prompt: HTMLElement;

  constructor() {
    this.root.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${HUD_Z_INDEX - 1};`;
    this.black.style.cssText = "position:absolute;inset:0;background:#000;opacity:0;";
    const lid = (edge: "top" | "bottom") =>
      `position:absolute;left:0;right:0;${edge}:0;height:0;background:#000;box-shadow:0 0 ${LID_FEATHER}px ${LID_FEATHER / 2}px #000;display:none;`;
    this.upperLid.style.cssText = lid("top");
    this.lowerLid.style.cssText = lid("bottom");
    this.root.append(this.black, this.upperLid, this.lowerLid);
    document.body.appendChild(this.root);

    this.title = document.getElementById(TITLE_ID) ?? createTitle();
    this.name = document.getElementById(NAME_ID)!;
    this.prompt = document.getElementById(PROMPT_ID)!;
  }

  /** Lays the title out exactly as a camera with this vertical field of view sees the sky's from `depth` above
   *  it (vh: the canvas fills the window). public/index.html carries the same numbers for the default camera. */
  layoutTitle(fovDegrees: number, depth: number): void {
    const vhPerUnit = 100 / (2 * depth * Math.tan((fovDegrees * Math.PI) / 360));
    const place = (el: HTMLElement, fontPx: number, labelWidth: number, aboveCenter: number) => {
      const size = fontPx * (labelWidth / LABEL_CANVAS_WIDTH) * vhPerUnit;
      el.style.fontSize = `${size}vh`;
      el.style.top = `${50 - aboveCenter * vhPerUnit - LABEL_MIDDLE_LIFT * size}vh`;
    };
    place(this.name, TITLE_FONT_PX, TITLE_WIDTH * TITLE_DEPTH, TITLE_ABOVE_CENTER * TITLE_DEPTH);
    place(this.prompt, PROMPT_FONT_PX, PROMPT_WIDTH * TITLE_DEPTH, 0);
  }

  /** The title takes the click from now on. drei's PointerLockControls listens on the DOCUMENT: the click is
   *  stopped here, then re-dispatched as a synthetic document click so drei locks the element ITS controls are
   *  connected to (three-stdlib only flips isLocked for that one), inside this click's user activation. A
   *  click made while the game was loading enters at once, without the lock (the next click on the world
   *  takes it). */
  openGate(onEnter: () => void): void {
    const early = this.title.dataset.early === "1";
    this.title.dataset.ready = "1";
    if (early) {
      onEnter();
      return;
    }
    this.title.style.cursor = "pointer";
    this.title.onclick = (e) => {
      e.stopPropagation();
      this.title.onclick = (stop) => stop.stopPropagation();
      this.title.style.cursor = "default";
      document.dispatchEvent(new MouseEvent("click"));
      onEnter();
    };
  }

  setPrompt(text: string): void {
    this.prompt.textContent = text;
  }

  /** The fall begins: the sky's own title takes over. */
  removeTitle(): void {
    this.title.remove();
  }

  /** 0 = clear, 1 = black. */
  setBlack(opacity: number): void {
    this.black.style.opacity = String(Math.min(Math.max(opacity, 0), 1));
  }

  /** 0 = eyes shut, 1 = open (the lids gone). */
  setEyes(open: number): void {
    const shown = open < 1;
    const height = `${(1 - Math.min(Math.max(open, 0), 1)) * 50}vh`;
    for (const lid of [this.upperLid, this.lowerLid]) {
      lid.style.display = shown ? "block" : "none";
      lid.style.height = height;
    }
  }

  dispose(): void {
    this.removeTitle();
    this.root.remove();
  }
}

/** The page's title markup, for a page that lacks it (a test, a page reloaded without index.html's). */
const createTitle = (): HTMLElement => {
  const title = document.createElement("div");
  title.id = TITLE_ID;
  title.style.cssText = `position:fixed;inset:0;background:#000;z-index:${HUD_Z_INDEX - 1};font-family:${FONT};color:#fff;user-select:none;`;
  const line = (id: string, text: string) => {
    const el = document.createElement("div");
    el.id = id;
    el.textContent = text;
    el.style.cssText = "position:absolute;left:0;right:0;transform:translateY(calc(-50% - 0.06em));text-align:center;line-height:1;white-space:nowrap;";
    title.appendChild(el);
  };
  line(NAME_ID, "dotcomma");
  line(PROMPT_ID, PROMPT_ENTER);
  document.body.appendChild(title);
  return title;
};
