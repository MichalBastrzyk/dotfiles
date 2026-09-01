import type { Account, AccountUsage, ProviderId, UsageWindow } from "../domain.ts";
import { GROUP_NAMES, formatResetDuration, sanitizeDisplay, usageBar, windowAbbr } from "./account-row.ts";
import { PROVIDER_ART } from "./provider-art.ts";
import { truncateToWidth, visibleWidth } from "./terminal-text.ts";

type Fg = (color: "accent" | "border" | "text" | "muted" | "dim" | "success" | "warning" | "error", text: string) => string;
export type AccountRow =
  | { kind: "spacer" }
  | { kind: "art"; line: string }
  | { kind: "header"; provider: ProviderId }
  | { kind: "empty"; provider: ProviderId }
  | { kind: "account"; account: Account; index: number };

export const buildRows = (accounts: readonly Account[], order: readonly ProviderId[]) => order.flatMap((provider, groupIndex): AccountRow[] => {
  const group = accounts.filter((account) => account.provider === provider);
  const rows: AccountRow[] = groupIndex > 0 ? [{ kind: "spacer" }] : [];
  rows.push(...PROVIDER_ART[provider].map((line) => ({ kind: "art" as const, line })));
  rows.push(group.length ? { kind: "header", provider } : { kind: "empty", provider });
  rows.push(...group.map((account, index) => ({ kind: "account" as const, account, index })));
  return rows;
});

const windowChunk = (id: string, window: UsageWindow, now: number, fg: Fg) => {
  const { bar, remaining } = usageBar(window);
  const color = remaining >= 50 ? "success" : remaining >= 20 ? "warning" : "error";
  const reset = formatResetDuration(window.resetsAt, now);
  return `${fg("muted", `${windowAbbr(id)} `)}${fg(color, bar)} ${remaining}%${reset ? fg("dim", ` ↻${reset}`) : ""}`;
};

const compactUsage = (usage: AccountUsage, now: number, fg: Fg) => {
  const body = Object.entries(usage.windows).map(([id, window]) => windowChunk(id, window, now, fg)).join(fg("dim", " · "));
  return usage.plan ? `${fg("dim", `${usage.plan} · `)}${body}` : body;
};

export const renderAccountRow = (row: AccountRow, selected: boolean, width: number, accounts: readonly Account[], activeAccounts: Partial<Record<ProviderId, string>> | undefined, usage: AccountUsage | "loading" | "unavailable", now: number, fg: Fg) => {
  if (row.kind === "spacer") return "";
  if (row.kind === "art") return `   ${fg("accent", row.line)}`;
  if (row.kind === "header") return `   ${fg("muted", `${GROUP_NAMES[row.provider]} · ${accounts.filter((account) => account.provider === row.provider).length}`)}`;
  if (row.kind === "empty") return `   ${fg("dim", `${GROUP_NAMES[row.provider]}: no accounts`)}`;
  const account = row.account;
  const marker = selected ? fg("accent", "❯") : " ";
  const dot = activeAccounts?.[account.provider] === account.id ? fg("success", "●") : fg("dim", "○");
  const label = sanitizeDisplay(account.label || account.id);
  const idSuffix = account.id !== account.label ? ` (${sanitizeDisplay(account.id)})` : "";
  const left = `   ${marker} ${dot} ${selected ? fg("accent", label) : label}${fg("dim", idSuffix)}`;
  const right = usage === "loading" ? fg("dim", "loading…") : usage === "unavailable" ? fg("muted", "unavailable") : compactUsage(usage, now, fg);
  const leftTrimmed = truncateToWidth(left, Math.max(0, width - visibleWidth(right) - 2));
  const gap = " ".repeat(Math.max(2, width - visibleWidth(leftTrimmed) - visibleWidth(right)));
  return truncateToWidth(leftTrimmed + gap + right, width);
};

export const renderBusyBox = (contentWidth: number, spinner: string, target: string, step: string, cancellable: boolean, fg: Fg) => {
  const inner = Math.max(1, Math.min(48, contentWidth - 2));
  const margin = " ".repeat(Math.max(0, Math.floor((contentWidth - inner - 2) / 2)));
  const center = (content: string) => {
    const fitted = truncateToWidth(content, inner), total = Math.max(0, inner - visibleWidth(fitted)), left = Math.floor(total / 2);
    return `${margin}│${" ".repeat(left)}${fitted}${" ".repeat(total - left)}│`;
  };
  return [
    `${margin}╭${"─".repeat(inner)}╮`,
    center(fg("accent", `${spinner}  Switching to ${truncateToWidth(target, inner - 24)}…`)),
    center(""),
    center(fg("text", truncateToWidth(step, inner - 4))),
    center(fg("dim", cancellable ? "[Esc] Cancel" : "finalizing…")),
    `${margin}╰${"─".repeat(inner)}╯`,
  ];
};
