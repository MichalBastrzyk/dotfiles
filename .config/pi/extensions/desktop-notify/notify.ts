import { appendFileSync } from "node:fs";
import { loadConfig } from "./config.ts";
import {
  notificationSequence,
  resolveProtocol,
  wrapForTmux,
  type NotificationProtocol,
} from "./protocol.ts";
import { sanitizeNotificationText } from "./sanitize.ts";

type Channel = "dev-tty" | "stdout";
type Writer = { isTTY?: boolean; write(chunk: string): unknown };

interface NotifierDeps {
  env: NodeJS.ProcessEnv;
  stdout: Writer;
  writeDevTty: (chunk: string) => boolean;
}

export interface NotificationResult {
  notified: boolean;
  protocol?: NotificationProtocol;
  channel?: Channel;
  reason?: "disabled" | "non-tty";
}

function writeDevTty(chunk: string) {
  try {
    appendFileSync("/dev/tty", chunk, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function notifyTurnComplete(
  dependencies: Partial<NotifierDeps> = {},
): NotificationResult {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;
  const config = loadConfig(env);
  if (!config.enabled) return { notified: false, reason: "disabled" };

  const title = sanitizeNotificationText(config.title, "Pi", 64);
  const body = sanitizeNotificationText(config.body, "Turn complete", 180);
  const protocol = resolveProtocol(env, config.protocol);
  const sequence = wrapForTmux(
    notificationSequence(protocol, title, body),
    env,
    config.tmuxPassthrough,
  );

  if ((dependencies.writeDevTty ?? writeDevTty)(sequence)) {
    return { notified: true, protocol, channel: "dev-tty" };
  }
  if (!stdout.isTTY) return { notified: false, reason: "non-tty" };

  stdout.write(sequence);
  return { notified: true, protocol, channel: "stdout" };
}
