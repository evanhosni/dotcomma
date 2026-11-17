/** <WaterfallBoulders/>, a part of the <Water> base. */
export const WATERFALL_BOULDERS = "waterfallBoulders";
export interface WaterfallBouldersParams {
  /** One rock per this many units squared on a fall… */
  spacing: number;
  /** …and in calm water. */
  calmSpacing: number;
}
export const WATERFALL_BOULDER_DEFAULTS: WaterfallBouldersParams = { spacing: 14, calmSpacing: 32 };
