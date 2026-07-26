export const severities = ["critical", "major", "minor", "trivial", "info"] as const;

export type Severity = (typeof severities)[number];

export interface ReviewContextEvent {
  readonly type: "review_context";
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface StatusEvent {
  readonly type: "status";
  readonly status?: string;
  readonly message?: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface HeartbeatEvent {
  readonly type: "heartbeat";
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface FindingEvent {
  readonly type: "finding";
  readonly severity: Severity;
  readonly fileName: string;
  readonly codegenInstructions?: string;
  readonly comment?: string;
  readonly suggestions: ReadonlyArray<string>;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface CompleteEvent {
  readonly type: "complete";
  readonly status?: string;
  readonly findings?: number;
  readonly message?: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface ErrorEvent {
  readonly type: "error";
  readonly message?: string;
  readonly candidates: ReadonlyArray<string>;
  readonly candidatesNote?: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface UnknownEvent {
  readonly type: "unknown";
  readonly eventType: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export type CodeRabbitEvent =
  | ReviewContextEvent
  | StatusEvent
  | HeartbeatEvent
  | FindingEvent
  | CompleteEvent
  | ErrorEvent
  | UnknownEvent;

export type ReviewScope =
  | { readonly kind: "uncommitted"; readonly includeUntracked: boolean }
  | { readonly kind: "committed" }
  | { readonly kind: "all"; readonly includeUntracked: boolean }
  | { readonly kind: "base"; readonly branch: string; readonly includeUntracked: boolean };

export interface ReviewRequest {
  readonly scope: ReviewScope;
  readonly light: boolean;
}

export interface MalformedLine {
  readonly line: string;
  readonly reason: string;
}

export type ReviewRunnerUpdate =
  | { readonly _tag: "RepositoryResolved"; readonly repositoryRoot: string }
  | { readonly _tag: "ProcessStarted" }
  | { readonly _tag: "EventReceived"; readonly event: CodeRabbitEvent }
  | { readonly _tag: "MalformedLine"; readonly malformedLine: MalformedLine }
  | { readonly _tag: "StdoutClosed" }
  | { readonly _tag: "ProcessExited"; readonly exitCode: number };

export interface ReviewResult {
  readonly request: ReviewRequest;
  readonly repositoryRoot: string;
  readonly findings: ReadonlyArray<FindingEvent>;
  readonly complete: CompleteEvent;
  readonly errors: ReadonlyArray<ErrorEvent>;
  readonly unknownEvents: ReadonlyArray<UnknownEvent>;
  readonly malformedLines: ReadonlyArray<MalformedLine>;
  readonly stderr: string;
  readonly exitCode: number;
}
