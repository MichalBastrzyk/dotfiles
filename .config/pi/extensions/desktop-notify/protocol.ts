import type { ProtocolPreference } from "./config.ts";

export type NotificationProtocol = "osc9" | "osc777";

export function resolveProtocol(
  env: NodeJS.ProcessEnv,
  preferred: ProtocolPreference,
): NotificationProtocol {
  if (preferred !== "auto") return preferred;

  const terminal = env.TERM_PROGRAM?.toLowerCase();
  if (
    terminal === "iterm.app" ||
    terminal === "wezterm" ||
    env.ITERM_SESSION_ID ||
    env.WEZTERM_EXECUTABLE ||
    env.WEZTERM_PANE ||
    env.ZELLIJ ||
    env.ZELLIJ_SESSION_NAME
  ) {
    return "osc9";
  }

  return "osc777";
}

export function notificationSequence(
  protocol: NotificationProtocol,
  title: string,
  body: string,
) {
  return protocol === "osc9"
    ? `\u001b]9;${title}: ${body}\u001b\\`
    : `\u001b]777;notify;${title};${body}\u001b\\`;
}

export function wrapForTmux(
  sequence: string,
  env: NodeJS.ProcessEnv,
  enabled: boolean,
) {
  if (!enabled || !env.TMUX) return sequence;
  return `\u001bPtmux;${sequence.replaceAll("\u001b", "\u001b\u001b")}\u001b\\`;
}
