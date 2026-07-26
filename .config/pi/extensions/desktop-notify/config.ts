export type ProtocolPreference = "auto" | "osc9" | "osc777";

export interface NotificationConfig {
  enabled: boolean;
  protocol: ProtocolPreference;
  title: string;
  body: string;
  tmuxPassthrough: boolean;
}

function booleanValue(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  if (["1", "true", "yes", "on"].includes(value.trim().toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.trim().toLowerCase())) return false;
  return fallback;
}

function protocolValue(value: string | undefined): ProtocolPreference {
  const normalized = value?.trim().toLowerCase();
  return normalized === "osc9" || normalized === "osc777" ? normalized : "auto";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NotificationConfig {
  return {
    enabled: booleanValue(env.PI_NOTIFY_DESKTOP_ENABLED, true),
    protocol: protocolValue(env.PI_NOTIFY_DESKTOP_PROTOCOL),
    title: env.PI_NOTIFY_DESKTOP_TITLE?.trim() || "Pi",
    body: env.PI_NOTIFY_DESKTOP_BODY?.trim() || "Turn complete — awaiting feedback",
    tmuxPassthrough: booleanValue(env.PI_NOTIFY_DESKTOP_TMUX_PASSTHROUGH, true),
  };
}
