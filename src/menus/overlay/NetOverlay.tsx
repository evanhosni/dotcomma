import { useConnectionState } from "../../net/connection";
import { useRosterVersion, getRemotePlayers } from "../../net/players/store";
import { HUD_COLOR, HUD_Z_INDEX, PANEL_STYLE } from "./styles";

const NET_PANEL_STYLE: React.CSSProperties = { ...PANEL_STYLE, position: "fixed", top: 12, right: 12, zIndex: HUD_Z_INDEX };

const STATUS_LABEL = {
  connecting: "connecting…",
  connected: "online",
  reconnecting: "reconnecting…",
  offline: "offline",
} as const;

/**
 * Connection status HUD (top-right). Re-renders only on UI-cadence events:
 * status changes and roster changes — never on movement.
 */
export const NetOverlay = () => {
  const { status, selfId, color } = useConnectionState();
  useRosterVersion();
  const others = getRemotePlayers().size;

  return (
    <div style={NET_PANEL_STYLE}>
      <span style={{ color: status === "connected" ? HUD_COLOR : "#ff0" }}>● </span>
      {STATUS_LABEL[status]}
      {status === "connected" && (
        <>
          {"\n"}
          <span style={{ color: color ?? HUD_COLOR }}>■ </span>
          {`you  ${selfId?.slice(0, 8) ?? ""}`}
          {"\n"}
          {`here ${others + 1}`}
        </>
      )}
    </div>
  );
};
