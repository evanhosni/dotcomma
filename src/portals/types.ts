/** Indoor worlds are placed at this Y offset to isolate them from outdoor physics */
export const INDOOR_Y_OFFSET = 10000;

export interface IndoorWorldProps {
  entryPortalPos: THREE.Vector3;
}
