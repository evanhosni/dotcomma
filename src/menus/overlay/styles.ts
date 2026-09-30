import type React from "react";

/** THE overlay look (CLAUDE.md → "UI / Overlay Styling"): green-on-black terminal panels. */

export const FONT = "'Kode Mono', 'Courier New', Courier, monospace";
export const HUD_COLOR = "#0f0";
export const PANEL_BACKGROUND = "rgba(0,0,0,0.6)";
export const HUD_Z_INDEX = 1000;

/** A HUD panel for React `style` props. */
export const PANEL_STYLE: React.CSSProperties = {
  pointerEvents: "none",
  fontFamily: FONT,
  fontSize: 12,
  lineHeight: 1.5,
  color: HUD_COLOR,
  background: PANEL_BACKGROUND,
  borderRadius: 4,
  padding: "8px 12px",
  whiteSpace: "pre",
};

/** The overlay font as a cssText fragment, for imperatively built DOM. */
export const FONT_CSS = `font-family:${FONT};font-size:12px;line-height:1.5;`;

/** PANEL_STYLE as a cssText string, for imperatively built DOM. */
export const PANEL_CSS =
  `background:${PANEL_BACKGROUND};color:${HUD_COLOR};${FONT_CSS}` +
  "padding:8px 12px;border-radius:4px;pointer-events:none;white-space:pre;";
