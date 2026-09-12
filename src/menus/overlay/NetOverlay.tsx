import { useConnectionState } from "../../net/connection";
import { useRosterVersion, getRemotePlayers } from "../../net/players/store";

/**
 * Connection status HUD (top-right). Re-renders only on UI-cadence events:
 * status changes and roster changes — never on movement.
 */
const PANEL_STYLE: React.CSSProperties = {
  position: "fixed",
  top: 12,
  right: 12,
  zIndex: 1000,
  pointerEvents: "none",
  fontFamily: "'Kode Mono', 'Courier New', Courier, monospace",
  fontSize: 12,
  lineHeight: 1.5,
  color: "#0f0",
  background: "rgba(0,0,0,0.6)",
  borderRadius: 4,
  padding: "8px 12px",
  whiteSpace: "pre",
};

const STATUS_LABEL = {
  connecting: "connecting…",
  connected: "online",
  reconnecting: "reconnecting…",
  offline: "offline",
} as const;

export const NetOverlay = () => {
  const { status, selfId, color } = useConnectionState();
  useRosterVersion();
  const others = getRemotePlayers().size;

  return (
    <div style={PANEL_STYLE}>
      <span style={{ color: status === "connected" ? "#0f0" : "#ff0" }}>● </span>
      {STATUS_LABEL[status]}
      {status === "connected" && (
        <>
          {"\n"}
          <span style={{ color: color ?? "#0f0" }}>■ </span>
          {`you  ${selfId?.slice(0, 8) ?? ""}`}
          {"\n"}
          {`here ${others + 1}`}
        </>
      )}
    </div>
  );
};
