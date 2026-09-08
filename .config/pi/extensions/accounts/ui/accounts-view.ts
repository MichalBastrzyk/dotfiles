import type { Account, AccountUsage, ProviderId } from "../domain.ts";
import { PROVIDER_IDS } from "../providers/catalog.ts";
import { sanitizeDisplay } from "./account-row.ts";
import { decodeAccountsInput, defaultKeybindings, keyHint, type AccountsCommand, type AccountsKeybindings } from "./accounts-input.ts";
import { buildRows, renderAccountRow, renderBusyBox, type AccountRow } from "./accounts-render.ts";
import { pad, truncateToWidth, visibleWidth } from "./terminal-text.ts";

export { defaultKeybindings } from "./accounts-input.ts";
export type { AccountsKeybindings } from "./accounts-input.ts";

export type AccountsViewAction =
  | { type: "switch"; account: Account }
  | { type: "add" }
  | { type: "remove"; account: Account }
  | { type: "close" };

export interface AccountsTheme {
  fg?(color: "accent" | "border" | "text" | "muted" | "dim" | "success" | "warning" | "error", text: string): string;
  bold?(text: string): string;
}

export interface AccountsViewOptions {
  accounts: ReadonlyArray<Account>;
  currentModel?: string;
  activeAccounts?: Partial<Record<ProviderId, string>>;
  usageFor(account: Account, force: boolean, signal: AbortSignal): Promise<AccountUsage>;
  requestRender(): void;
  onAction(action: AccountsViewAction): void;
  theme?: AccountsTheme;
  keybindings?: AccountsKeybindings;
  getRows?: () => number;
}

const order: ProviderId[] = [...PROVIDER_IDS];
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
type Color = Parameters<NonNullable<AccountsTheme["fg"]>>[0];
type RenderContext = {
  width: number;
  innerWidth: number;
  contentWidth: number;
  height: number;
  start: number;
  selectedLine: number;
  fg: (color: Color, text: string) => string;
  fgBox: (color: Color, text: string) => string;
  padded: (line: string) => string;
};

export class AccountsView {
  private selected = 0;
  private busy?: string;
  private busyStep = "";
  private busyCancellable = false;
  private onCancel: (() => void) | null = null;
  private spinnerFrame = 0;
  private spinnerTimer?: ReturnType<typeof setInterval>;
  private scrollStart = 0;
  private usage = new Map<string, AccountUsage | "loading" | "unavailable">();
  private controller?: AbortController;
  private generation = 0;
  private disposed = false;
  private ticker?: ReturnType<typeof setInterval>;
  private readonly accounts: Account[];
  private readonly rows: AccountRow[];

  constructor(private readonly options: AccountsViewOptions) {
    this.accounts = [...options.accounts].sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
    this.rows = buildRows(this.accounts, order);
    for (const account of this.accounts) this.usage.set(this.key(account), "loading");
    this.ticker = setInterval(() => this.options.requestRender(), 1000);
    this.load(false);
  }

  private key(account: Account) { return `${account.provider}/${account.id}`; }
  private accountCount() { return this.accounts.length; }
  private selectedIndex() { return Math.max(0, Math.min(this.accountCount() - 1, this.selected)); }
  private selectedAccount(): Account | undefined { return this.accounts[this.selectedIndex()]; }

  private select(index: number) {
    this.selected = Math.max(0, Math.min(this.accountCount() - 1, index));
    this.ensureVisible();
    this.options.requestRender();
  }
  private ensureVisible() {
    const height = this.bodyHeight();
    const selectedLine = this.rows.findIndex((row) => row.kind === "account" && row.index === this.selectedIndex());
    if (selectedLine <= this.scrollStart) this.scrollStart = Math.max(0, selectedLine - 1);
    else if (selectedLine >= this.scrollStart + height) this.scrollStart = selectedLine - height + 2;
    this.scrollStart = Math.max(0, Math.min(this.scrollStart, Math.max(0, this.rows.length - height)));
  }
  private move(delta: number) {
    if (this.accountCount()) this.select(this.selectedIndex() + delta);
  }
  private page() { return Math.max(1, this.bodyHeight() - 2); }

  private readonly commandHandlers: Record<AccountsCommand, () => void> = {
    cancelBusy: () => this.onCancel?.(),
    close: () => this.close(),
    confirm: () => this.actOnSelected("switch"),
    up: () => this.move(-1),
    down: () => this.move(1),
    pageUp: () => this.move(-this.page()),
    pageDown: () => this.move(this.page()),
    first: () => this.selectEdge(false),
    last: () => this.selectEdge(true),
    add: () => { this.stopLoading(); this.options.onAction({ type: "add" }); },
    refresh: () => this.load(true),
    remove: () => this.actOnSelected("remove"),
  };

  handleInput(data: string) {
    if (this.disposed) return;
    const command = decodeAccountsInput(data, this.options.keybindings ?? defaultKeybindings(), Boolean(this.busy), this.busyCancellable);
    if (command) this.commandHandlers[command]();
  }

  private actOnSelected(type: "switch" | "remove") {
    const account = this.selectedAccount();
    if (!account) return;
    if (type === "remove") this.stopLoading();
    this.options.onAction({ type, account });
  }

  private selectEdge(last: boolean) {
    this.select(last ? Number.MAX_SAFE_INTEGER : 0);
    this.scrollStart = last ? Math.max(0, this.rows.length - this.bodyHeight()) : 0;
  }

  invalidate() {}
  dispose() {
    this.disposed = true;
    if (this.ticker) { clearInterval(this.ticker); this.ticker = undefined; }
    if (this.spinnerTimer) { clearInterval(this.spinnerTimer); this.spinnerTimer = undefined; }
    this.stopLoading();
  }

  /** In-place updates used by the host while the overlay stays mounted. */
  setBusy(accountKey?: string) { this.setBusyState(accountKey, "", false, null); }
  /** Full busy control: step text, whether Cancel can abort, cancel callback. */
  setBusyState(accountKey: string | undefined, step: string, cancellable: boolean, onCancel: (() => void) | null) {
    if (this.disposed) return;
    this.busy = accountKey;
    this.busyStep = step;
    this.busyCancellable = cancellable;
    this.onCancel = onCancel;
    if (accountKey && !this.spinnerTimer) {
      this.spinnerFrame = 0;
      this.spinnerTimer = setInterval(() => {
        this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER.length;
        this.options.requestRender();
      }, 120);
    }
    if (!accountKey && this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = undefined;
    }
    this.options.requestRender();
  }
  setActiveAccounts(map?: Partial<Record<ProviderId, string>>) { if (!this.disposed) { this.options.activeAccounts = map; this.options.requestRender(); } }

  private close() {
    this.dispose();
    this.options.onAction({ type: "close" });
  }
  private stopLoading() {
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
  }

  private bodyHeight() {
    const rows = (this.options.getRows?.() ?? 30) || 30;
    return Math.max(6, rows - 8);
  }

  render(width: number): string[] {
    const context = this.renderContext(width);
    const lines = [...this.renderHeader(context), ...this.renderBody(context), this.renderFrameEdge(context, false)];
    this.renderBusyOverlay(lines, context);
    lines.push(this.renderFooter(context));
    return lines;
  }

  private renderContext(width: number): RenderContext {
    const theme = this.options.theme;
    const dimmed = this.busy !== undefined;
    const fg = (color: Color, text: string) => theme?.fg?.(dimmed ? "dim" : color, text) ?? text;
    const innerWidth = Math.max(0, width - 2);
    const contentWidth = Math.max(10, innerWidth - 4);
    this.ensureVisible();
    return {
      width, innerWidth, contentWidth, height: this.bodyHeight(), start: this.scrollStart,
      selectedLine: this.rows.findIndex((row) => row.kind === "account" && row.index === this.selectedIndex()),
      fg, fgBox: (color, text) => theme?.fg?.(color, text) ?? text,
      padded: (line) => fg("border", "│") + "  " + pad(line, contentWidth) + "  " + fg("border", "│"),
    };
  }

  private renderFrameEdge({ fg, innerWidth }: RenderContext, top: boolean) {
    return fg("border", top ? "╭" : "╰") + fg("border", "─".repeat(innerWidth)) + fg("border", top ? "╮" : "╯");
  }

  private renderHeader(context: RenderContext) {
    const { fg, padded, contentWidth } = context;
    const activeLabels = this.accounts.filter((account) => this.options.activeAccounts?.[account.provider] === account.id)
      .map((account) => sanitizeDisplay(account.label || account.id));
    const right = [this.options.currentModel, activeLabels.length ? `active: ${activeLabels.join(", ")}` : undefined].filter(Boolean).join(" · ");
    const left = fg("accent", this.options.theme?.bold?.("Accounts") ?? "Accounts");
    const info = fg("dim", right);
    const gap = Math.max(2, contentWidth - visibleWidth(left) - visibleWidth(info));
    return [this.renderFrameEdge(context, true), padded(""), padded(`${left}${" ".repeat(gap)}${info}`), padded(fg("border", "─".repeat(contentWidth))), padded("")];
  }

  private renderBody(context: RenderContext) {
    const { start, height, selectedLine, contentWidth, fg, padded } = context;
    const rendered = this.rows.slice(start, start + height).map((row, offset) => renderAccountRow(
      row, start + offset === selectedLine, contentWidth, this.accounts, this.options.activeAccounts,
      row.kind === "account" ? this.usage.get(this.key(row.account)) ?? "loading" : "loading", Date.now(), fg,
    ));
    return Array.from({ length: height }, (_, index) => {
      if (start > 0 && index === 0) return padded(fg("dim", `… ${start} more above`));
      if (start + height < this.rows.length && index === height - 1) return padded(fg("dim", `… ${this.rows.length - start - height} more below`));
      return padded(rendered[index] ?? "");
    });
  }

  private renderBusyOverlay(lines: string[], context: RenderContext) {
    if (!this.busy) return;
    const account = this.accounts.find((candidate) => this.key(candidate) === this.busy);
    const target = account ? sanitizeDisplay(account.label || account.id) : "account";
    const box = renderBusyBox(context.contentWidth, SPINNER[this.spinnerFrame], target, this.busyStep, this.busyCancellable, context.fgBox);
    const boxTop = Math.max(0, Math.min(Math.floor((context.height - box.length) / 2), context.height - box.length));
    box.forEach((line, index) => {
      const targetLine = 5 + boxTop + index;
      if (targetLine >= 5 && targetLine < 5 + context.height) lines[targetLine] = context.padded(line);
    });
  }

  private renderFooter({ fg, width }: RenderContext) {
    const kb = this.options.keybindings ?? defaultKeybindings();
    return truncateToWidth(fg("dim", `  ${keyHint(kb, "tui.select.up", "↑")}/${keyHint(kb, "tui.select.down", "↓")}/j/k select · pgup/pgdn · ${keyHint(kb, "tui.select.confirm", "enter")} switch · a add · d remove · r refresh · ${keyHint(kb, "tui.select.cancel", "esc")} close`), width);
  }

  private load(force: boolean) {
    this.stopLoading();
    if (this.disposed || !this.accounts.length) return;
    const generation = this.generation, controller = this.controller = new AbortController();
    for (const account of this.accounts) this.usage.set(this.key(account), "loading");
    this.options.requestRender();
    let next = 0;
    const worker = async () => {
      while (!controller.signal.aborted) {
        const account = this.accounts[next++];
        if (!account) return;
        let result: AccountUsage | "unavailable";
        try { result = await this.options.usageFor(account, force, controller.signal); }
        catch { result = "unavailable"; }
        if (controller.signal.aborted || generation !== this.generation || this.disposed) return;
        this.usage.set(this.key(account), result);
        this.options.requestRender();
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, this.accounts.length) }, worker));
  }
}
