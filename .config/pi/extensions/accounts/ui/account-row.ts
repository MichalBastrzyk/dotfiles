import type { Account, UsageWindow } from "../domain.ts";

export const GROUP_NAMES: Readonly<Record<string, string>> = {
  "openai-codex": "OpenAI Codex",
  "opencode-go": "OpenCode Go",
};

const clampPercent = (value: number) => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

export const remainingPercent = ({ used, limit }: UsageWindow) =>
  clampPercent(limit > 0 ? 100 - (used / limit) * 100 : 0);

export const formatResetDuration = (resetsAt: number | undefined, now = Date.now()) => {
  if (resetsAt === undefined) return "";
  const seconds = Math.max(0, Math.ceil((resetsAt - now) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24), restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
};

/** Terminal progress bar in the style of the ChatGPT usage panel: filled `▰` on an empty `▱` track. */
const WINDOW_ABBR = new Map([
  ["5h", "5h"], ["weekly", "wk"], ["rolling", "roll"], ["monthly", "mo"], ["daily", "day"],
]);
export const windowAbbr = (id: string) => WINDOW_ABBR.get(id) ?? id.slice(0, 5);

export const usageBar = (window: UsageWindow, width = 8): { bar: string; remaining: number } => {
  const remaining = Math.round(remainingPercent(window));
  const filled = Math.round((remaining / 100) * width);
  return { bar: "▰".repeat(filled) + "▱".repeat(Math.max(0, width - filled)), remaining };
};

export const sanitizeDisplay = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/gu, "�");
