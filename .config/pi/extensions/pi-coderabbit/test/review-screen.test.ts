import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { FindingEvent, ReviewRequest, ReviewResult } from "../src/domain.ts";
import {
  CodeRabbitReviewScreen,
  type ReviewConsoleResult,
} from "../src/review-screen.ts";
import {
  ReviewStateStore,
  type ReviewSessionView,
  type ReviewState,
} from "../src/review-session.ts";

const request: ReviewRequest = {
  light: false,
  scope: { kind: "uncommitted", includeUntracked: false },
  directory: "packages/web",
};

const finding: FindingEvent = {
  type: "finding",
  severity: "critical",
  fileName: "src/auth.ts",
  codegenInstructions: "Validate the session before granting access.",
  suggestions: ["if (!session.valid) throw new Error(\"invalid\")"],
  raw: {},
};

const result: ReviewResult = {
  request,
  repositoryRoot: "/repo",
  findings: [finding],
  complete: { type: "complete", status: "completed", findings: 1, raw: {} },
  errors: [],
  unknownEvents: [],
  malformedLines: [],
  stderr: "",
  exitCode: 0,
};

class FakeSession implements ReviewSessionView {
  cancelCalls = 0;
  disposeCalls = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private state: ReviewState) {}

  getState(): ReviewState {
    return this.state;
  }

  setState(state: ReviewState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async cancel(): Promise<void> {
    this.cancelCalls += 1;
  }

  dispose(): void {
    this.disposeCalls += 1;
  }
}

const runningState = (): ReviewState => {
  const store = new ReviewStateStore(request, "/repo", () => 1_000);
  store.apply({ _tag: "ProcessStarted" });
  return store.getState();
};

const runningWithFindingsState = (): ReviewState => {
  const store = new ReviewStateStore(request, "/repo", () => 1_000);
  store.apply({ _tag: "ProcessStarted" });
  for (let index = 1; index <= 20; index += 1) {
    store.apply({
      _tag: "EventReceived",
      event: {
        ...finding,
        fileName: `src/finding-${index}.ts`,
        codegenInstructions: `Finding ${index} details.`,
      },
    });
  }
  return store.getState();
};

const completedState = (): ReviewState => {
  const store = new ReviewStateStore(request, "/repo", () => 1_000);
  store.complete(result);
  return store.getState();
};

const cancelledState = (): ReviewState => {
  const store = new ReviewStateStore(request, "/repo", () => 1_000);
  store.apply({ _tag: "ProcessStarted" });
  store.beginCancelling();
  store.finishCancelling();
  return store.getState();
};

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const keybindings = {
  matches: (data: string, binding: string) => {
    const keys: Readonly<Record<string, string>> = {
      "tui.editor.cursorUp": "up",
      "tui.editor.cursorDown": "down",
      "tui.editor.pageUp": "pageUp",
      "tui.editor.pageDown": "pageDown",
    };
    return keys[binding] === data;
  },
} as unknown as KeybindingsManager;

const createScreen = (session: FakeSession) => {
  let renders = 0;
  const tui = {
    terminal: { rows: 40 },
    requestRender: () => {
      renders += 1;
    },
  } as unknown as TUI;
  const results: ReviewConsoleResult[] = [];
  const screen = new CodeRabbitReviewScreen(tui, theme, keybindings, session, (result) => {
    results.push(result);
  });
  return { screen, results, renders: () => renders };
};

describe("CodeRabbitReviewScreen", () => {
  it("requires confirmation before Escape cancels an active review", async () => {
    const session = new FakeSession(runningState());
    const { screen, results, renders } = createScreen(session);

    screen.handleInput("\u001b");
    expect(session.cancelCalls).toBe(0);
    expect(results).toEqual([]);
    expect(renders()).toBeGreaterThan(0);

    screen.handleInput("\r");
    await Promise.resolve();
    expect(session.cancelCalls).toBe(1);
    expect(results).toEqual([{ action: "cancelled" }]);
  });

  it("cancels directly on Ctrl+C", async () => {
    const session = new FakeSession(runningState());
    const { screen, results } = createScreen(session);

    screen.handleInput("\u0003");
    await Promise.resolve();
    expect(session.cancelCalls).toBe(1);
    expect(results).toEqual([{ action: "cancelled" }]);
  });

  it("displays every live finding and follows new arrivals", () => {
    const session = new FakeSession(runningState());
    const { screen } = createScreen(session);

    session.setState(runningWithFindingsState());
    const latestPage = screen.render(100).join("\n");
    expect(latestPage).toContain("folder: packages/web");
    expect(latestPage).toContain("All findings (20)");
    expect(latestPage).toContain("src/finding-20.ts");
    expect(latestPage).not.toContain("src/finding-1.ts");

    screen.handleInput("g");
    const firstPage = screen.render(100).join("\n");
    expect(firstPage).toContain("src/finding-1.ts");
    screen.dispose();
  });

  it("keeps completed results open for full-view and explicit handoff", () => {
    const session = new FakeSession(completedState());
    const { screen, results } = createScreen(session);

    const compact = screen.render(100).join("\n");
    expect(compact).not.toContain("if (!session.valid)");

    screen.handleInput("V");
    const full = screen.render(100).join("\n");
    expect(full).toContain("if (!session.valid)");
    expect(results).toEqual([]);

    screen.handleInput("\r");
    expect(results).toEqual([{ action: "send", result }]);
  });

  it("closes completed results without sending on Q", () => {
    const session = new FakeSession(completedState());
    const { screen, results } = createScreen(session);

    screen.handleInput("q");
    expect(results).toEqual([{ action: "dismiss" }]);
  });

  it("renders settled cancellation as terminal rather than in progress", () => {
    const session = new FakeSession(cancelledState());
    const { screen } = createScreen(session);

    const output = screen.render(100).join("\n");
    expect(output).toContain("Status      Review cancelled");
    expect(output).toContain("Cancellation complete.");
    screen.dispose();
  });

  it("never renders lines wider than the available terminal width", () => {
    const session = new FakeSession(completedState());
    const { screen } = createScreen(session);

    expect(screen.render(72).every((line) => visibleWidth(line) <= 72)).toBe(true);
    screen.dispose();
  });
});
