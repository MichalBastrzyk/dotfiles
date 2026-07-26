import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import type { FindingEvent, ReviewResult, Severity } from "./domain.ts";
import type { ReviewSessionView, ReviewState } from "./review-session.ts";

export type ReviewConsoleResult =
  | { readonly action: "send"; readonly result: ReviewResult }
  | { readonly action: "dismiss" }
  | { readonly action: "cancelled" };

const severityOrder: ReadonlyArray<Severity> = ["critical", "major", "minor", "trivial", "info"];
const SCROLL_STEP = 3;

const sanitizeText = (text: string): string =>
  text
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/gu, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\u001b[@-_]/gu, "")
    .replaceAll("\t", "  ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, "");

const oneLine = (text: string): string => sanitizeText(text).replace(/\s+/gu, " ").trim();

export const formatDuration = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

const scopeLabel = (state: ReviewState): string => {
  const directory = state.request.directory ? ` · folder: ${state.request.directory}` : "";
  const suffix = `${directory}${state.request.light ? " · light" : ""}`;
  switch (state.request.scope.kind) {
    case "uncommitted":
      return `${state.request.scope.includeUntracked ? "Uncommitted changes + untracked files" : "Uncommitted tracked changes"}${suffix}`;
    case "committed":
      return `Committed changes${suffix}`;
    case "all":
      return `${state.request.scope.includeUntracked ? "All tracked + untracked changes" : "All tracked changes"}${suffix}`;
    case "base":
      return `Changes against ${state.request.scope.branch}${state.request.scope.includeUntracked ? " + untracked files" : ""}${suffix}`;
  }
};

const findingBody = (finding: FindingEvent): string =>
  finding.codegenInstructions ?? finding.comment ?? "No details were provided.";

const severityCounts = (findings: ReadonlyArray<FindingEvent>): string =>
  severityOrder
    .map((severity) => {
      const count = findings.filter((finding) => finding.severity === severity).length;
      return count === 0 ? undefined : `${count} ${severity}`;
    })
    .filter((part): part is string => part !== undefined)
    .join("   ");

export class CodeRabbitReviewScreen implements Component {
  private readonly unsubscribe: () => void;
  private readonly ticker: ReturnType<typeof setInterval>;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private cancelConfirmation = false;
  private fullFindings = false;
  private scrollOffset = 0;
  private followRunningFindings = true;
  private runningFindingCount: number;
  private lastStateTag: ReviewState["_tag"];

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly session: ReviewSessionView,
    private readonly done: (result: ReviewConsoleResult) => void,
  ) {
    const state = session.getState();
    this.runningFindingCount = state.findings.length;
    this.lastStateTag = state._tag;
    this.unsubscribe = session.subscribe(() => {
      const next = session.getState();
      if (
        (next._tag === "Preparing" || next._tag === "Running") &&
        next.findings.length > this.runningFindingCount &&
        this.followRunningFindings
      ) {
        this.scrollOffset = Number.MAX_SAFE_INTEGER;
      }
      if (
        (next._tag === "Completed" || next._tag === "Failed") &&
        next._tag !== this.lastStateTag
      ) {
        this.scrollOffset = 0;
      }
      this.runningFindingCount = next.findings.length;
      this.lastStateTag = next._tag;
      this.scheduleRender();
    });
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
  }

  private scheduleRender(): void {
    if (this.renderTimer !== undefined || this.closed) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      if (!this.closed) this.tui.requestRender();
    }, 50);
  }

  private cleanup(): boolean {
    if (this.closed) return false;
    this.closed = true;
    this.unsubscribe();
    clearInterval(this.ticker);
    if (this.renderTimer !== undefined) clearTimeout(this.renderTimer);
    this.renderTimer = undefined;
    this.session.dispose();
    return true;
  }

  private close(result: ReviewConsoleResult): void {
    if (this.cleanup()) this.done(result);
  }

  dispose(): void {
    this.cleanup();
  }

  private cancelReview(): void {
    const state = this.session.getState();
    if (state._tag !== "Preparing" && state._tag !== "Running") return;
    this.cancelConfirmation = false;
    this.tui.requestRender();
    void this.session.cancel().then(() => this.close({ action: "cancelled" }));
  }

  handleInput(data: string): void {
    const state = this.session.getState();

    if (state._tag === "Preparing" || state._tag === "Running") {
      if (matchesKey(data, "ctrl+c")) {
        this.cancelReview();
        return;
      }
      if (this.cancelConfirmation) {
        if (matchesKey(data, "enter")) this.cancelReview();
        else if (matchesKey(data, "escape")) {
          this.cancelConfirmation = false;
          this.tui.requestRender();
        }
        return;
      }
      if (matchesKey(data, "escape")) {
        this.cancelConfirmation = true;
        this.tui.requestRender();
        return;
      }
      if (this.handleScroll(data)) {
        this.followRunningFindings = data === "G";
      }
      return;
    }

    if (state._tag === "Cancelling" || state._tag === "Cancelled") return;

    if (state._tag === "Completed") {
      if (matchesKey(data, "enter")) {
        this.close({ action: "send", result: state.result });
        return;
      }
      if (data === "q" || data === "Q" || matchesKey(data, "ctrl+c")) {
        this.close({ action: "dismiss" });
        return;
      }
      if (data === "v" || data === "V") {
        this.fullFindings = !this.fullFindings;
        this.scrollOffset = 0;
        this.tui.requestRender();
        return;
      }
      this.handleScroll(data);
      return;
    }

    if (
      matchesKey(data, "enter") ||
      data === "q" ||
      data === "Q" ||
      matchesKey(data, "ctrl+c")
    ) {
      this.close({ action: "dismiss" });
      return;
    }
    this.handleScroll(data);
  }

  private handleScroll(data: string): boolean {
    if (this.keybindings.matches(data, "tui.editor.cursorUp") || data === "k") {
      this.scrollOffset = Math.max(0, this.scrollOffset - SCROLL_STEP);
    } else if (this.keybindings.matches(data, "tui.editor.cursorDown") || data === "j") {
      this.scrollOffset += SCROLL_STEP;
    } else if (this.keybindings.matches(data, "tui.editor.pageUp")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - this.viewportHeight());
    } else if (this.keybindings.matches(data, "tui.editor.pageDown")) {
      this.scrollOffset += this.viewportHeight();
    } else if (data === "g") {
      this.scrollOffset = 0;
    } else if (data === "G") {
      this.scrollOffset = Number.MAX_SAFE_INTEGER;
    } else {
      return false;
    }
    this.tui.requestRender();
    return true;
  }

  private viewportHeight(): number {
    return Math.max(4, (this.tui.terminal.rows || 30) - 12);
  }

  private pad(text: string, width: number): string {
    const truncated = truncateToWidth(text, width);
    return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
  }

  private frameLine(text: string, innerWidth: number): string {
    return (
      this.theme.fg("borderAccent", "│") +
      ` ${this.pad(text, innerWidth)} ` +
      this.theme.fg("borderAccent", "│")
    );
  }

  private renderFrame(width: number, body: ReadonlyArray<string>): string[] {
    if (width < 8) return body.map((line) => truncateToWidth(line, width));

    const innerWidth = width - 4;
    const title = " CodeRabbit Review ";
    const titleWidth = Math.min(visibleWidth(title), Math.max(0, width - 2));
    const top =
      this.theme.fg("borderAccent", "┌─") +
      this.theme.fg("accent", this.theme.bold(truncateToWidth(title, titleWidth))) +
      this.theme.fg("borderAccent", "─".repeat(Math.max(0, width - titleWidth - 3)) + "┐");
    const bottom = this.theme.fg("borderAccent", `└${"─".repeat(Math.max(0, width - 2))}┘`);
    return [truncateToWidth(top, width), ...body.map((line) => this.frameLine(line, innerWidth)), bottom];
  }

  private detail(label: string, value: string): string {
    return `${this.theme.fg("muted", label.padEnd(12))}${this.theme.fg("text", oneLine(value))}`;
  }

  private milestone(done: boolean, active: boolean, label: string): string {
    const glyph = done ? this.theme.fg("success", "✓") : active ? this.theme.fg("accent", "●") : this.theme.fg("dim", "○");
    const text = done ? this.theme.fg("success", label) : active ? this.theme.fg("text", label) : this.theme.fg("dim", label);
    return `  ${glyph} ${text}`;
  }

  private runningBody(state: ReviewState, capacity: number): string[] {
    const now = Date.now();
    const heartbeat = state.lastHeartbeatAt
      ? `${Math.max(0, Math.floor((now - state.lastHeartbeatAt) / 1000))} seconds ago`
      : "Waiting for first heartbeat";
    const latestActivity = state.recentActivity.at(-1);
    const header = [
      "",
      this.detail("Scope", scopeLabel(state)),
      this.detail("Repository", state.repositoryRoot ?? state.cwd),
      this.detail("Elapsed", formatDuration(now - state.startedAt)),
      this.detail("Status", state.status),
      this.detail("Heartbeat", heartbeat),
      this.detail("Streams", `stdout ${state.stdoutActive ? "active" : "closed"} · process ${state.processAlive ? "alive" : "not running"}`),
      this.theme.fg("accent", this.theme.bold("Progress")),
      this.milestone(state.repositoryRoot !== undefined, state.repositoryRoot === undefined, "Repository detected"),
      this.milestone(state.reviewContextPrepared, state.processAlive && !state.reviewContextPrepared, "Review context prepared"),
      this.milestone(state.completeEventReceived, state.processAlive && !state.completeEventReceived, "Code analysis running"),
      this.milestone(state.completeEventReceived, state.findings.length > 0 && !state.completeEventReceived, "Processing findings"),
      this.milestone(false, false, "Delivering review to agent"),
      this.detail("Events", `${state.eventCount} parsed · ${state.malformedLineCount} malformed`),
      this.detail("Findings", String(state.findings.length)),
      severityCounts(state.findings) ? `  ${this.theme.fg("muted", severityCounts(state.findings))}` : "",
      latestActivity
        ? this.detail(
            "Activity",
            `${formatDuration(latestActivity.at - state.startedAt)} · ${latestActivity.message}`,
          )
        : "",
      this.theme.fg("accent", this.theme.bold(`All findings (${state.findings.length})`)),
    ];
    const findingRows = state.findings.map((finding, index) => {
      const severity = this.theme.fg(
        finding.severity === "critical" ? "error" : "warning",
        `[${finding.severity.toUpperCase()}]`,
      );
      const summary = oneLine(findingBody(finding));
      return `  ${index + 1}. ${severity} ${this.theme.fg("text", oneLine(finding.fileName))}${summary ? this.theme.fg("muted", ` — ${summary}`) : ""}`;
    });

    const statusHint =
      state._tag === "Cancelling"
        ? "Cancellation in progress…"
        : state._tag === "Cancelled"
          ? "Cancellation complete."
          : "Ctrl+C: cancel · Escape: cancellation confirmation";
    const footer = this.cancelConfirmation
      ? [
          this.theme.fg("warning", this.theme.bold("Cancel the active CodeRabbit review?")),
          this.theme.fg("dim", "Enter: cancel review · Escape: keep running"),
          this.theme.fg("muted", "The coding agent is paused until this review finishes."),
        ]
      : [
          this.theme.fg("dim", "↑/↓ or j/k: findings · PgUp/PgDn: page · g/G: top/latest"),
          this.theme.fg("dim", statusHint),
          this.theme.fg("muted", "The coding agent is paused until this review finishes."),
        ];
    const viewport = Math.max(1, capacity - header.length - footer.length);
    const maxOffset = Math.max(0, findingRows.length - viewport);
    this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
    const visible = findingRows.slice(this.scrollOffset, this.scrollOffset + viewport);
    const body = [
      ...header,
      ...(visible.length > 0 ? visible : [this.theme.fg("dim", "  Waiting for findings…")]),
    ];
    while (body.length < capacity - footer.length) body.push("");
    return [...body.slice(0, capacity - footer.length), ...footer];
  }

  private findingLines(findings: ReadonlyArray<FindingEvent>, width: number): string[] {
    const lines: string[] = [];
    for (const severity of severityOrder) {
      const group = findings.filter((finding) => finding.severity === severity);
      if (group.length === 0) continue;
      lines.push(this.theme.fg("accent", this.theme.bold(severity.toUpperCase())));
      for (const finding of group) {
        lines.push(`  ${this.theme.fg("warning", oneLine(finding.fileName))}`);
        const body = oneLine(findingBody(finding));
        const compactBody = body.length > 180 ? `${body.slice(0, 177)}...` : body;
        const visibleBody = this.fullFindings
          ? sanitizeText(findingBody(finding))
          : compactBody;
        for (const line of wrapTextWithAnsi(visibleBody, Math.max(1, width - 4))) {
          lines.push(`    ${this.theme.fg("text", line)}`);
        }
        if (this.fullFindings && finding.suggestions.length > 0) {
          lines.push(this.theme.fg("muted", "    Suggested content (verify before using):"));
          for (const suggestion of finding.suggestions) {
            for (const line of wrapTextWithAnsi(sanitizeText(suggestion), Math.max(1, width - 6))) {
              lines.push(`      ${this.theme.fg("dim", line)}`);
            }
          }
        }
        lines.push("");
      }
    }
    return lines;
  }

  private completedBody(state: ReviewState & { readonly _tag: "Completed" }, capacity: number, width: number): string[] {
    const elapsed = state.completedAt - state.startedAt;
    const skipped = state.result.complete.status === "review_skipped";
    const header = [
      "",
      this.theme.fg("success", this.theme.bold(`CodeRabbit review completed in ${formatDuration(elapsed)}`)),
      "",
      this.detail("Repository", state.result.repositoryRoot),
      this.detail("Scope", scopeLabel(state)),
      this.detail("Findings", String(state.result.findings.length)),
      severityCounts(state.result.findings) ? `  ${this.theme.fg("muted", severityCounts(state.result.findings))}` : "",
      skipped ? this.theme.fg("muted", state.result.complete.message ?? "CodeRabbit skipped this review.") : "",
      "",
    ];
    const enterHint = state.result.findings.length > 0
      ? "Enter: send findings to coding agent"
      : "Enter: close review";
    const footer = [
      this.theme.fg("dim", `${enterHint} · V: compact/full findings · Q: close without sending`),
      this.theme.fg("dim", "↑/↓ or j/k: scroll · PgUp/PgDn: page · g/G: top/bottom"),
    ];
    const viewport = Math.max(1, capacity - header.length - footer.length);
    const findings = this.findingLines(state.result.findings, width);
    const maxOffset = Math.max(0, findings.length - viewport);
    this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
    const visible = findings.slice(this.scrollOffset, this.scrollOffset + viewport);
    const body = [...header, ...(visible.length > 0 ? visible : [this.theme.fg("dim", "No findings were reported.")])];
    while (body.length < capacity - footer.length) body.push("");
    return [...body.slice(0, capacity - footer.length), ...footer];
  }

  private failedBody(state: ReviewState & { readonly _tag: "Failed" }, capacity: number, width: number): string[] {
    const header = [
      "",
      this.theme.fg("error", this.theme.bold("CodeRabbit review failed")),
      "",
      this.detail("Repository", state.repositoryRoot ?? state.cwd),
      this.detail("Elapsed", formatDuration(state.failedAt - state.startedAt)),
      "",
    ];
    const details = [state.message, state.stderr ? `stderr:\n${state.stderr}` : ""]
      .filter(Boolean)
      .flatMap((text) => wrapTextWithAnsi(sanitizeText(text), Math.max(1, width - 2)));
    const footer = [
      this.theme.fg("dim", "Enter or Q: close · ↑/↓ or j/k: scroll · PgUp/PgDn: page"),
    ];
    const viewport = Math.max(1, capacity - header.length - footer.length);
    const maxOffset = Math.max(0, details.length - viewport);
    this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
    const body = [...header, ...details.slice(this.scrollOffset, this.scrollOffset + viewport)];
    while (body.length < capacity - footer.length) body.push("");
    return [...body.slice(0, capacity - footer.length), ...footer];
  }

  private fit(main: ReadonlyArray<string>, footer: ReadonlyArray<string>, capacity: number): string[] {
    const mainCapacity = Math.max(0, capacity - footer.length);
    const body = [...main.slice(0, mainCapacity)];
    while (body.length < mainCapacity) body.push("");
    return [...body, ...footer.slice(0, capacity - body.length)];
  }

  render(width: number): string[] {
    const rows = this.tui.terminal.rows || 30;
    const capacity = Math.max(8, rows - 3);
    const state = this.session.getState();
    const innerWidth = Math.max(1, width - 4);
    const body =
      state._tag === "Completed"
        ? this.completedBody(state, capacity, innerWidth)
        : state._tag === "Failed"
          ? this.failedBody(state, capacity, innerWidth)
          : this.runningBody(state, capacity);
    return this.renderFrame(width, body);
  }

  invalidate(): void {}
}
