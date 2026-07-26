import { describe, expect, it } from "vitest";
import type { CompleteEvent, FindingEvent, ReviewRequest, ReviewResult } from "../src/domain.ts";
import { reviewDesktopNotification } from "../src/review-notification.ts";
import {
  CodeRabbitReviewSession,
  ReviewStateStore,
  type ReviewExecutor,
} from "../src/review-session.ts";

const request: ReviewRequest = {
  light: false,
  scope: { kind: "uncommitted", includeUntracked: false },
};

const completeEvent: CompleteEvent = {
  type: "complete",
  status: "completed",
  findings: 1,
  raw: {},
};

const finding: FindingEvent = {
  type: "finding",
  severity: "major",
  fileName: "src/example.ts",
  codegenInstructions: "Handle the failed operation.",
  suggestions: [],
  raw: {},
};

const result: ReviewResult = {
  request,
  repositoryRoot: "/repo",
  findings: [finding],
  complete: completeEvent,
  errors: [],
  unknownEvents: [],
  malformedLines: [],
  stderr: "",
  exitCode: 0,
};

describe("ReviewStateStore", () => {
  it("tracks live runner state and suppresses heartbeat activity spam", () => {
    let now = 1_000;
    const store = new ReviewStateStore(request, "/repo/subdir", () => now);

    now += 100;
    store.apply({ _tag: "RepositoryResolved", repositoryRoot: "/repo" });
    now += 100;
    store.apply({ _tag: "ProcessStarted" });
    const activityCount = store.getState().recentActivity.length;

    now += 1_000;
    store.apply({ _tag: "EventReceived", event: { type: "heartbeat", raw: {} } });
    now += 1_000;
    store.apply({ _tag: "EventReceived", event: { type: "heartbeat", raw: {} } });

    const state = store.getState();
    expect(state._tag).toBe("Running");
    expect(state.eventCount).toBe(2);
    expect(state.lastHeartbeatAt).toBe(now);
    expect(state.recentActivity).toHaveLength(activityCount);
    expect(state.processAlive).toBe(true);
    expect(state.stdoutActive).toBe(true);
  });

  it("does not complete until the runner returns after the complete event", () => {
    let now = 5_000;
    const store = new ReviewStateStore(request, "/repo", () => now);
    store.apply({ _tag: "ProcessStarted" });
    store.apply({ _tag: "EventReceived", event: finding });
    store.apply({ _tag: "EventReceived", event: completeEvent });

    expect(store.getState()._tag).toBe("Running");
    expect(store.getState().completeEventReceived).toBe(true);

    now += 2_000;
    store.apply({ _tag: "StdoutClosed" });
    store.apply({ _tag: "ProcessExited", exitCode: 0 });
    expect(store.getState()._tag).toBe("Running");

    store.complete(result);
    const completed = store.getState();
    expect(completed._tag).toBe("Completed");
    if (completed._tag === "Completed") {
      expect(completed.result).toBe(result);
      expect(completed.completedAt).toBe(now);
    }
  });

  it("moves to cancelling and records cleanup settlement", () => {
    const store = new ReviewStateStore(request, "/repo", () => 1_000);
    store.apply({ _tag: "ProcessStarted" });
    store.beginCancelling();
    expect(store.getState()._tag).toBe("Cancelling");

    store.finishCancelling();
    expect(store.getState()).toMatchObject({
      _tag: "Cancelled",
      processAlive: false,
      stdoutActive: false,
      status: "Review cancelled",
    });
  });

  it("waits for executor cleanup before cancellation settles", async () => {
    let releaseCleanup = () => {};
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let abortSeen = false;
    const executor: ReviewExecutor = ({ signal, onUpdate }) => {
      onUpdate({ _tag: "ProcessStarted" });
      return new Promise((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            abortSeen = true;
            void cleanup.then(() => reject(new Error("interrupted")));
          },
          { once: true },
        );
      });
    };
    const session = new CodeRabbitReviewSession(request, "/repo", executor);
    session.start();

    let settled = false;
    const cancellation = session.cancel().then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(abortSeen).toBe(true);
    expect(settled).toBe(false);
    expect(session.getState()._tag).toBe("Cancelling");

    releaseCleanup();
    await cancellation;
    expect(settled).toBe(true);
    expect(session.getState()).toMatchObject({
      _tag: "Cancelled",
      processAlive: false,
      stdoutActive: false,
    });
  });

  it("builds desktop notifications only for completion and failure", () => {
    const completed = new ReviewStateStore(request, "/repo", () => 1_000);
    completed.complete(result);
    expect(reviewDesktopNotification(completed.getState())).toEqual({
      title: "CodeRabbit review complete",
      body: "1 finding in /repo",
    });

    const failed = new ReviewStateStore(request, "/repo", () => 1_000);
    failed.fail(new Error("backend unavailable"));
    expect(reviewDesktopNotification(failed.getState())).toEqual({
      title: "CodeRabbit review failed",
      body: "/repo: backend unavailable",
    });

    const cancelled = new ReviewStateStore(request, "/repo", () => 1_000);
    cancelled.beginCancelling();
    cancelled.finishCancelling();
    expect(reviewDesktopNotification(cancelled.getState())).toBeUndefined();
  });

  it("never starts execution after cancellation or disposal", async () => {
    let executions = 0;
    const executor: ReviewExecutor = async () => {
      executions += 1;
      return result;
    };

    const cancelled = new CodeRabbitReviewSession(request, "/repo", executor);
    await cancelled.cancel();
    cancelled.start();
    expect(cancelled.getState()._tag).toBe("Cancelled");

    const disposed = new CodeRabbitReviewSession(request, "/repo", executor);
    disposed.dispose();
    disposed.start();
    expect(disposed.getState()._tag).toBe("Cancelled");
    expect(executions).toBe(0);
  });
});
