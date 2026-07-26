import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import type {
  CodeRabbitEvent,
  FindingEvent,
  ReviewRequest,
  ReviewResult,
  ReviewRunnerUpdate,
} from "./domain.ts";
import { CodeRabbitExecutionError, runCodeRabbitReview } from "./runner.ts";

const MAX_RECENT_ACTIVITY = 8;

export interface ReviewActivity {
  readonly at: number;
  readonly message: string;
}

interface ReviewLiveState {
  readonly request: ReviewRequest;
  readonly cwd: string;
  readonly startedAt: number;
  readonly repositoryRoot?: string;
  readonly status: string;
  readonly lastActivityAt: number;
  readonly lastHeartbeatAt?: number;
  readonly eventCount: number;
  readonly findings: ReadonlyArray<FindingEvent>;
  readonly recentActivity: ReadonlyArray<ReviewActivity>;
  readonly stdoutActive: boolean;
  readonly processAlive: boolean;
  readonly reviewContextPrepared: boolean;
  readonly completeEventReceived: boolean;
  readonly malformedLineCount: number;
}

export type ReviewState =
  | (ReviewLiveState & { readonly _tag: "Preparing" })
  | (ReviewLiveState & { readonly _tag: "Running" })
  | (ReviewLiveState & {
      readonly _tag: "Completed";
      readonly completedAt: number;
      readonly result: ReviewResult;
    })
  | (ReviewLiveState & {
      readonly _tag: "Failed";
      readonly failedAt: number;
      readonly message: string;
      readonly stderr: string;
    })
  | (ReviewLiveState & { readonly _tag: "Cancelling" })
  | (ReviewLiveState & {
      readonly _tag: "Cancelled";
      readonly cancelledAt: number;
    });

export interface ReviewSessionView {
  getState(): ReviewState;
  subscribe(listener: () => void): () => void;
  cancel(): Promise<void>;
  dispose(): void;
}

export interface ReviewExecutionOptions {
  readonly cwd: string;
  readonly request: ReviewRequest;
  readonly signal: AbortSignal;
  readonly onUpdate: (update: ReviewRunnerUpdate) => void;
}

export type ReviewExecutor = (options: ReviewExecutionOptions) => Promise<ReviewResult>;

const executeCodeRabbitReview: ReviewExecutor = ({ cwd, request, signal, onUpdate }) =>
  Effect.runPromise(
    runCodeRabbitReview({ cwd, request, onUpdate }).pipe(Effect.provide(NodeServices.layer)),
    { signal },
  );

const findingActivity = (finding: FindingEvent): string => {
  const detail = finding.codegenInstructions ?? finding.comment;
  const summary = detail?.split("\n", 1)[0]?.trim();
  return summary ? `Finding received: ${summary}` : `Finding received: ${finding.fileName}`;
};

export class ReviewStateStore {
  private state: ReviewState;
  private readonly listeners = new Set<() => void>();

  constructor(
    request: ReviewRequest,
    cwd: string,
    private readonly now: () => number = Date.now,
  ) {
    const startedAt = now();
    this.state = {
      _tag: "Preparing",
      request,
      cwd,
      startedAt,
      status: "Detecting Git repository",
      lastActivityAt: startedAt,
      eventCount: 0,
      findings: [],
      recentActivity: [{ at: startedAt, message: "Review requested" }],
      stdoutActive: false,
      processAlive: false,
      reviewContextPrepared: false,
      completeEventReceived: false,
      malformedLineCount: 0,
    };
  }

  getState(): ReviewState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Observers cannot affect the review lifecycle.
      }
    }
  }

  private update(patch: Partial<ReviewState>, activity?: string): void {
    const at = this.now();
    const recentActivity = activity
      ? [...this.state.recentActivity, { at, message: activity }].slice(-MAX_RECENT_ACTIVITY)
      : this.state.recentActivity;
    this.state = {
      ...this.state,
      ...patch,
      lastActivityAt: at,
      recentActivity,
    } as ReviewState;
    this.publish();
  }

  apply(update: ReviewRunnerUpdate): void {
    switch (update._tag) {
      case "RepositoryResolved":
        this.update(
          {
            repositoryRoot: update.repositoryRoot,
            status: "Repository detected",
          },
          "Repository detected",
        );
        return;

      case "ProcessStarted":
        this.update(
          {
            _tag:
              this.state._tag === "Cancelling" || this.state._tag === "Cancelled"
                ? this.state._tag
                : "Running",
            processAlive: true,
            stdoutActive: true,
            status: "CodeRabbit started",
          },
          "CodeRabbit process started",
        );
        return;

      case "StdoutClosed":
        this.update({ stdoutActive: false }, "CodeRabbit stdout closed");
        return;

      case "ProcessExited":
        this.update(
          { processAlive: false },
          `CodeRabbit process exited with status ${update.exitCode}`,
        );
        return;

      case "MalformedLine":
        this.update(
          { malformedLineCount: this.state.malformedLineCount + 1 },
          "Malformed CodeRabbit event ignored",
        );
        return;

      case "EventReceived":
        this.applyEvent(update.event);
    }
  }

  private applyEvent(event: CodeRabbitEvent): void {
    const eventCount = this.state.eventCount + 1;

    switch (event.type) {
      case "heartbeat": {
        const at = this.now();
        this.state = {
          ...this.state,
          eventCount,
          lastActivityAt: at,
          lastHeartbeatAt: at,
        };
        this.publish();
        return;
      }

      case "review_context":
        this.update(
          {
            eventCount,
            reviewContextPrepared: true,
            status: "Review context prepared",
          },
          "Review context prepared",
        );
        return;

      case "status": {
        const status = event.message ?? event.status ?? "CodeRabbit is reviewing";
        this.update(
          { eventCount, status },
          status === this.state.status ? undefined : status,
        );
        return;
      }

      case "finding":
        this.update(
          {
            eventCount,
            findings: [...this.state.findings, event],
            status: "Processing findings",
          },
          findingActivity(event),
        );
        return;

      case "complete":
        this.update(
          {
            eventCount,
            completeEventReceived: true,
            status: event.message ?? event.status ?? "Finalizing review",
          },
          "Complete event received; waiting for process exit",
        );
        return;

      case "error":
        this.update(
          { eventCount, status: event.message ?? "CodeRabbit reported an error" },
          event.message ?? "CodeRabbit reported an error",
        );
        return;

      case "unknown":
        this.update({ eventCount });
    }
  }

  beginCancelling(): void {
    if (this.state._tag !== "Preparing" && this.state._tag !== "Running") return;
    this.update({ _tag: "Cancelling", status: "Stopping CodeRabbit" }, "Cancellation requested");
  }

  finishCancelling(): void {
    if (this.state._tag !== "Cancelling") return;
    this.update(
      {
        _tag: "Cancelled",
        cancelledAt: this.now(),
        processAlive: false,
        stdoutActive: false,
        status: "Review cancelled",
      },
      "CodeRabbit stopped",
    );
  }

  complete(result: ReviewResult): void {
    this.update({
      _tag: "Completed",
      completedAt: this.now(),
      result,
      repositoryRoot: result.repositoryRoot,
      findings: result.findings,
      processAlive: false,
      stdoutActive: false,
      status: result.complete.message ?? result.complete.status ?? "Review completed",
      completeEventReceived: true,
      malformedLineCount: result.malformedLines.length,
    });
  }

  fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const details = error instanceof CodeRabbitExecutionError ? error.details : undefined;
    this.update({
      _tag: "Failed",
      failedAt: this.now(),
      message,
      stderr: details?.stderr?.trim() ?? "",
      repositoryRoot: details?.repositoryRoot ?? this.state.repositoryRoot,
      processAlive: false,
      stdoutActive: false,
      status: "Review failed",
    });
  }
}

export class CodeRabbitReviewSession implements ReviewSessionView {
  readonly store: ReviewStateStore;
  private readonly abortController = new AbortController();
  private settlement?: Promise<void>;
  private cancelRequested = false;

  constructor(
    request: ReviewRequest,
    cwd: string,
    private readonly execute: ReviewExecutor = executeCodeRabbitReview,
  ) {
    this.store = new ReviewStateStore(request, cwd);
  }

  getState(): ReviewState {
    return this.store.getState();
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  start(): void {
    if (this.settlement !== undefined || this.cancelRequested) return;

    this.settlement = this.execute({
      cwd: this.getState().cwd,
      request: this.getState().request,
      signal: this.abortController.signal,
      onUpdate: (update) => this.store.apply(update),
    })
      .then(
        (result) => {
          if (!this.cancelRequested) this.store.complete(result);
        },
        (error) => {
          if (!this.cancelRequested) this.store.fail(error);
        },
      )
      .finally(() => {
        if (this.cancelRequested) this.store.finishCancelling();
      });
  }

  cancel(): Promise<void> {
    const state = this.getState();
    if (state._tag !== "Preparing" && state._tag !== "Running" && state._tag !== "Cancelling") {
      return Promise.resolve();
    }

    if (!this.cancelRequested) {
      this.cancelRequested = true;
      this.store.beginCancelling();
      this.abortController.abort();
    }

    if (this.settlement === undefined) {
      this.store.finishCancelling();
      return Promise.resolve();
    }
    return this.settlement;
  }

  dispose(): void {
    void this.cancel();
  }
}
