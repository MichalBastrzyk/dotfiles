import { describe, expect, it, vi } from "vitest";
import type { AccountUsage, OpenCodeAccount } from "../domain.ts";
import { formatResetDuration, remainingPercent, sanitizeDisplay, usageBar, windowAbbr } from "../ui/account-row.ts";
import { AccountsView, defaultKeybindings, type AccountsViewAction } from "../ui/accounts-view.ts";
import { SecretInput, type SecretInputResult } from "../ui/secret-input.ts";

const account = (id: string): OpenCodeAccount => ({ id, label: `Label ${id}`, key: `credential-${id}`, provider: "opencode-go", kind: "api-key", createdAt: 0, updatedAt: 0 });
const usage = (id: string, remaining = 80): AccountUsage => ({ accountId: id, provider: "opencode-go", windows: { daily: { used: 100 - remaining, limit: 100, resetsAt: Date.now() + 3_600_000 } }, updatedAt: 0, plan: "pro" });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const identityTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

describe("SecretInput", () => {
  it("masks Unicode code points and edits without rendering the secret", () => {
    let result: SecretInputResult | undefined;
    const input = new SecretInput({ onDone: (value) => { result = value; }, requestRender: vi.fn() });
    input.handleInput("a🔑c"); input.handleInput("\x1b[D"); input.handleInput("\x7f"); input.handleInput("b");
    const rendered = input.render(80).join("\n");
    expect(rendered).toContain("••▏•"); expect(rendered).not.toContain("abc"); expect(rendered).not.toContain("🔑");
    input.handleInput("\r");
    expect(result).toEqual({ type: "submit", value: "abc" });
  });
  it("accepts bracketed paste without ever rendering its value", () => {
    const done = vi.fn(), input = new SecretInput({ onDone: done, requestRender: vi.fn() });
    input.handleInput("\x1b[200~sk-");
    input.handleInput("pasted\x1b[201~");
    expect(input.render(80).join("")).toContain("•••••••••");
    expect(input.render(80).join("")).not.toContain("sk-pasted");
    input.handleInput("\r");
    expect(done).toHaveBeenCalledWith({ type: "submit", value: "sk-pasted" });
  });
  it("accepts bracketed paste markers split across input calls", () => {
    const done = vi.fn(), input = new SecretInput({ onDone: done, requestRender: vi.fn() });
    input.handleInput("\x1b[20"); input.handleInput("0~split"); input.handleInput(" value\x1b[20"); input.handleInput("1~");
    input.handleInput("\r");
    expect(done).toHaveBeenCalledWith({ type: "submit", value: "split value" });
  });
  it("ignores an unknown escape sequence split across input calls", () => {
    const done = vi.fn(), input = new SecretInput({ onDone: done, requestRender: vi.fn() });
    input.handleInput("\x1b["); input.handleInput("D"); input.handleInput("kept"); input.handleInput("\r");
    expect(done).toHaveBeenCalledWith({ type: "submit", value: "kept" });
  });
  it("supports delete/home/end and cancel clears and disables exposure", () => {
    const done = vi.fn(); const input = new SecretInput({ onDone: done, requestRender: vi.fn() });
    input.handleInput("abc"); input.handleInput("\x1b[H"); input.handleInput("\x1b[3~"); input.handleInput("\x1b[F"); input.handleInput("d"); input.handleInput("\x1b");
    expect(done).toHaveBeenCalledWith({ type: "cancel" }); expect(input.render(80).join("")).not.toContain("abcd");
    input.dispose(); input.handleInput("x"); expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("usage bars", () => {
  it("renders a filled/empty track from remaining percent with clamping", () => {
    expect(usageBar({ used: 20, limit: 100 })).toEqual({ bar: "▰▰▰▰▰▰▱▱", remaining: 80 });
    expect(usageBar({ used: 100, limit: 100 })).toEqual({ bar: "▱▱▱▱▱▱▱▱", remaining: 0 });
    expect(usageBar({ used: 0, limit: 100 })).toEqual({ bar: "▰▰▰▰▰▰▰▰", remaining: 100 });
    expect(usageBar({ used: -50, limit: 100 }).remaining).toBe(100);
    expect(remainingPercent({ used: 25, limit: 100 })).toBe(75);
    expect(formatResetDuration(90_000, 0)).toBe("2m");
    expect(sanitizeDisplay("bad\u001b[31m")).not.toContain("\u001b");
    expect(sanitizeDisplay("safe\u2028line\u2029paragraph\u202espoof\u2066hidden\u200b")).toBe("safe�line�paragraph�spoof�hidden�");
    expect(windowAbbr("constructor")).toBe("const");
  });
});

describe("AccountsView", () => {
  const view = (accounts: OpenCodeAccount[], options: Partial<ConstructorParameters<typeof AccountsView>[0]> = {}) => {
    const actions: AccountsViewAction[] = [], requestRender = vi.fn();
    const instance = new AccountsView({
      accounts, currentModel: "go/model", activeAccounts: { "opencode-go": accounts[0]?.id },
      requestRender, onAction: (action) => actions.push(action),
      usageFor: () => new Promise(() => {}), theme: identityTheme, getRows: () => 30,
      ...options,
    });
    return { instance, actions, requestRender };
  };

  it("renders immediately with bars, relative resets, and never shows credentials", async () => {
    const resolvers: Array<(value: AccountUsage) => void> = [];
    const { instance, requestRender } = view([account("a"), account("b")], {
      usageFor: (_a, _force, signal) => new Promise<AccountUsage>((resolve) => { signal.addEventListener("abort", () => {}); resolvers.push(resolve); }),
    });
    const initial = instance.render(120).join("\n");
    expect(initial).toContain("loading…");
    expect(initial).not.toContain("credential-");
    const before = requestRender.mock.calls.length;
    resolvers[1]!(usage("b", 84));
    await tick();
    expect(requestRender.mock.calls.length).toBeGreaterThan(before);
    const rendered = instance.render(120).join("\n");
    expect(rendered).toContain("▰▰▰▰▰▰▰▱");
    expect(rendered).toContain("84%");
    expect(rendered).toContain("↻1h");
    expect(rendered).toContain("pro · ");
    expect(rendered).toContain("OpenCode Go · 2");
    instance.dispose();
  });

  it("sanitizes the active account label in the header", () => {
    const unsafe = { ...account("a"), label: "safe\u202espoof" };
    const { instance } = view([unsafe]);
    const rendered = instance.render(120).join("\n");
    expect(rendered).toContain("active: safe�spoof");
    expect(rendered).not.toContain("\u202e");
    instance.dispose();
  });

  it("renders readable keybinding hints instead of raw escape sequences", () => {
    const { instance } = view([account("a")]);
    const footer = instance.render(120).at(-1)!;
    expect(footer).toContain("↑/↓/j/k select");
    expect(footer).not.toContain("\x1b[A");
    instance.dispose();
  });

  it("renders rows through ANSI-themed output (no blank lines)", () => {
    const theme = { fg: (_c: string, t: string) => `\x1b[36m${t}\x1b[0m`, bold: (t: string) => `\x1b[1m${t}\x1b[0m` };
    const instance = new AccountsView({ accounts: [account("a")], currentModel: "go/model", requestRender: vi.fn(), onAction: vi.fn(), usageFor: () => new Promise(() => {}), theme, getRows: () => 30 });
    const rendered = instance.render(120).join("\n");
    expect(rendered).toContain("Label a");
    expect(rendered).toContain("loading…");
    expect(rendered).toContain("esc close");
    expect(rendered).toContain("Accounts");
    expect(rendered).toContain("go/model");
    instance.dispose();
  });

  it("resets ANSI styling when a themed row is truncated", () => {
    const theme = { fg: (_c: string, text: string) => `\x1b[36m${text}\x1b[0m`, bold: (text: string) => text };
    const long = { ...account("a"), label: "x".repeat(100) };
    const { instance } = view([long], { theme });
    const row = instance.render(40).find((line) => line.includes("xxxx"));
    expect(row).toContain("\x1b[0m  \x1b[36m│");
    instance.dispose();
  });

  it("renders a centered busy box with spinner, step, and cancel hint while switching", () => {
    const { instance } = view([account("a"), account("b")]);
    const cancel = vi.fn();
    instance.setBusyState("opencode-go/b", "Validating credentials…", true, cancel);
    const lines = instance.render(120);
    const rendered = lines.join("\n");
    expect(rendered).toContain("Switching to Label b…");
    expect(rendered).toContain("Validating credentials…");
    expect(rendered).toContain("[Esc] Cancel");
    // horizontally centered: the "Switching" text sits well past the left border
    const boxLine = lines.find((l) => l.includes("Switching to"));
    expect(boxLine).toBeDefined();
    expect(boxLine!.indexOf("Switching to")).toBeGreaterThan(20);
    // spinner animates
    const frames = ["⠋", "⠙", "⠹", "⠸"];
    expect(frames.some((f) => rendered.includes(f))).toBe(true);
    // input ignored while busy
    const before = instance["selected"];
    instance.handleInput("j");
    expect(instance["selected"]).toBe(before);
    instance.handleInput("c"); instance.handleInput("\r");
    expect(cancel).toHaveBeenCalledTimes(2);
    // non-cancellable phase hides the cancel hint
    instance.setBusyState("opencode-go/b", "Activating account…", false, null);
    expect(instance.render(120).join("\n")).toContain("finalizing…");
    instance.setBusy(undefined);
    expect(instance.render(120).join("\n")).not.toContain("Switching to");
    instance.dispose();
  });

  it("does not restart busy rendering after disposal", () => {
    const { instance, requestRender } = view([account("a")]);
    instance.dispose();
    const before = requestRender.mock.calls.length;
    instance.setBusyState("opencode-go/a", "Validating credentials…", true, () => {});
    instance.setActiveAccounts({ "opencode-go": "a" });
    expect(instance["spinnerTimer"]).toBeUndefined();
    expect(requestRender).toHaveBeenCalledTimes(before);
  });

  it("renders the complete busy box at the minimum body height", () => {
    const { instance } = view([account("a")], { getRows: () => 14 });
    instance.setBusyState("opencode-go/a", "Validating credentials…", true, () => {});
    const lines = instance.render(80);
    expect(lines.slice(0, -2).some((line) => line.includes("╰"))).toBe(true);
    instance.dispose();
  });

  it("does not throw when rendered below the border width", () => {
    const { instance } = view([account("a")]);
    expect(() => instance.render(0)).not.toThrow();
    expect(() => instance.render(1)).not.toThrow();
    instance.dispose();
  });

  it("marks the active account and groups empty providers", () => {
    const { instance } = view([account("a")]);
    const rendered = instance.render(120).join("\n");
    expect(rendered).toContain("●");
    expect(rendered).toContain("OpenAI Codex: no accounts");
    instance.dispose();
  });

  it("scrolls the window around the selection with more-above/below markers", () => {
    const accounts = Array.from({ length: 10 }, (_, i) => account(String(i)));
    const { instance } = view(accounts, { getRows: () => 12 });
    expect(instance.render(120).join("\n")).toContain("more below");
    for (let i = 0; i < 3; i++) instance.handleInput("j");
    const scrolled = instance.render(120).join("\n");
    expect(scrolled).toContain("more above");
    expect(scrolled).toContain("more below");
    instance.handleInput("G");
    const bottom = instance.render(120).join("\n");
    expect(bottom).toContain("Label 9");
    expect(bottom).not.toContain("more below");
    instance.handleInput("g");
    const top = instance.render(120).join("\n");
    expect(top).toContain("Label 0");
    expect(top).not.toContain("Label 9");
    instance.dispose();
  });

  it("navigates with arrows/vim keys/pages and closes on escape from raw keys and keybindings", () => {
    const accounts = Array.from({ length: 8 }, (_, i) => account(String(i)));
    const customKb = { matches: vi.fn((data: string, binding: string) => binding === "tui.select.cancel" && data === "\x1b"), getKeys: () => ["esc"] };
    const { instance, actions } = view(accounts, { keybindings: customKb, getRows: () => 30 });
    instance.handleInput("\x1b[B"); instance.handleInput("j"); instance.handleInput("\x1b[6~");
    expect(instance["selected"]).toBe(7);
    instance.handleInput("k"); instance.handleInput("g"); expect(instance["selected"]).toBe(0);
    instance.handleInput("G"); expect(instance["selected"]).toBe(7);
    instance.handleInput("\x1b[5~"); expect(instance["selected"]).toBe(0);
    instance.handleInput("\x1b");
    expect(actions.at(-1)).toEqual({ type: "close" });
    expect(customKb.matches).toHaveBeenCalled();
    instance.dispose();
  });

  it("maps enter/a/d/r actions and force-refreshes", async () => {
    const usageCalls: Array<{ account: OpenCodeAccount; force: boolean }> = [];
    const { instance, actions } = view([account("a"), account("b")], {
      usageFor: (used, force) => { usageCalls.push({ account: used as OpenCodeAccount, force }); return new Promise(() => {}); },
    });
    instance.handleInput("\x1b[B");
    instance.handleInput("\r");
    expect(actions[0]).toEqual({ type: "switch", account: account("b") });
    instance.handleInput("a"); expect(actions[1]).toEqual({ type: "add" });
    instance.handleInput("d"); expect(actions[2]).toEqual({ type: "remove", account: account("b") });
    instance.handleInput("r");
    expect(usageCalls.at(-1)?.force).toBe(true);
    expect(instance["generation"]).toBe(4);
    instance.dispose();
  });

  it("limits usage concurrency to four and aborts pending work on dispose", async () => {
    let active = 0, peak = 0, aborted = 0;
    const controllers: AbortSignal[] = [];
    const accounts = Array.from({ length: 9 }, (_, i) => account(String(i)));
    const { instance } = view(accounts, {
      usageFor: (_a, _force, signal) => new Promise((_resolve, reject) => {
        controllers.push(signal); signal.addEventListener("abort", () => { aborted++; reject(signal.reason); });
        peak = Math.max(peak, ++active); setTimeout(() => { active--; }, 3);
      }),
    });
    await tick();
    expect(peak).toBe(4);
    instance.dispose();
    await tick();
    expect(aborted).toBe(4);
  });
});

describe("defaultKeybindings", () => {
  it("matches raw escape/enter/arrows and exposes hint labels", () => {
    const kb = defaultKeybindings();
    expect(kb.matches("\x1b", "tui.select.cancel")).toBe(true);
    expect(kb.matches("\r", "tui.select.confirm")).toBe(true);
    expect(kb.matches("\x1b[A", "tui.select.up")).toBe(true);
    expect(kb.getKeys("tui.select.cancel")).toEqual(["\x1b", "\x03"]);
  });
});
