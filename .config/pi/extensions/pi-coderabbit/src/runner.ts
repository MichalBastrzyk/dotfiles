import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type {
  CompleteEvent,
  ErrorEvent,
  FindingEvent,
  MalformedLine,
  ReviewRequest,
  ReviewResult,
  ReviewRunnerUpdate,
  UnknownEvent,
} from "./domain.ts";
import { toCodeRabbitArguments } from "./args.ts";
import { parseCodeRabbitLine } from "./parser.ts";

const MAX_STDERR_CHARACTERS = 64_000;

export interface ReviewRunnerOptions {
  readonly cwd: string;
  readonly request: ReviewRequest;
  readonly onUpdate?: (update: ReviewRunnerUpdate) => void;
}

export class CodeRabbitExecutionError extends Error {
  readonly _tag = "CodeRabbitExecutionError";

  constructor(
    message: string,
    readonly details: {
      readonly repositoryRoot?: string;
      readonly exitCode?: number;
      readonly stderr?: string;
      readonly errors?: ReadonlyArray<ErrorEvent>;
      readonly malformedLines?: ReadonlyArray<MalformedLine>;
    } = {},
  ) {
    super(message);
    this.name = "CodeRabbitExecutionError";
  }
}

const platformFailure = (operation: string, cause: unknown): CodeRabbitExecutionError =>
  new CodeRabbitExecutionError(`${operation} failed: ${String(cause)}`);

const collectText = (stream: Stream.Stream<Uint8Array, unknown>): Effect.Effect<string, unknown> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (accumulator, chunk) => {
        const combined = accumulator + chunk;
        return combined.length <= MAX_STDERR_CHARACTERS
          ? combined
          : combined.slice(combined.length - MAX_STDERR_CHARACTERS);
      },
    ),
  );

const safeUpdate = (
  callback: ReviewRunnerOptions["onUpdate"],
  update: ReviewRunnerUpdate,
): Effect.Effect<void> =>
  Effect.sync(() => {
    try {
      callback?.(update);
    } catch {
      // Rendering must never interrupt or fail the review process.
    }
  });

const resolveRepositoryRoot = Effect.fn("pi-coderabbit.resolveRepositoryRoot")(function* (cwd: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner
    .spawn(
      ChildProcess.make("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        detached: false,
        forceKillAfter: "5 seconds",
      }),
    )
    .pipe(Effect.mapError((cause) => platformFailure("Starting git", cause)));

  const [stdout, stderr, exitCode] = yield* Effect.all(
    [collectText(handle.stdout), collectText(handle.stderr), handle.exitCode] as const,
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError((cause) => platformFailure("Reading git output", cause)));

  const numericExitCode = Number(exitCode);
  const root = stdout.trim();

  if (numericExitCode !== 0 || root.length === 0) {
    return yield* Effect.fail(
      new CodeRabbitExecutionError("The current directory is not inside a Git repository.", {
        exitCode: numericExitCode,
        stderr: stderr.trim(),
      }),
    );
  }

  return root;
});

export const runCodeRabbitReview = (options: ReviewRunnerOptions) =>
  Effect.gen(function* () {
    const repositoryRoot = yield* resolveRepositoryRoot(options.cwd);
    yield* safeUpdate(options.onUpdate, { _tag: "RepositoryResolved", repositoryRoot });

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const findings: FindingEvent[] = [];
    const errors: ErrorEvent[] = [];
    const unknownEvents: UnknownEvent[] = [];
    const malformedLines: MalformedLine[] = [];
    let complete: CompleteEvent | undefined;

    const commandArguments = toCodeRabbitArguments(options.request);
    const handle = yield* spawner
      .spawn(
        ChildProcess.make("coderabbit", commandArguments, {
          cwd: repositoryRoot,
          env: { NO_COLOR: "1" },
          extendEnv: true,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          forceKillAfter: "5 seconds",
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new CodeRabbitExecutionError(
              "Could not start CodeRabbit. Confirm that `coderabbit` is installed and available on PATH.",
              { repositoryRoot, stderr: String(cause) },
            ),
        ),
      );

    yield* safeUpdate(options.onUpdate, { _tag: "ProcessStarted" });

    const consumeStdout = handle.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => {
        if (line.trim().length === 0) return Effect.void;

        return parseCodeRabbitLine(line).pipe(
          Effect.flatMap((event) =>
            Effect.gen(function* () {
              yield* safeUpdate(options.onUpdate, { _tag: "EventReceived", event });

              switch (event.type) {
                case "finding":
                  findings.push(event);
                  break;
                case "error":
                  errors.push(event);
                  break;
                case "complete":
                  complete = event;
                  break;
                case "unknown":
                  unknownEvents.push(event);
                  break;
              }
            }),
          ),
          Effect.catch((error) => {
            const malformedLine = { line, reason: error.reason } satisfies MalformedLine;
            malformedLines.push(malformedLine);
            return safeUpdate(options.onUpdate, { _tag: "MalformedLine", malformedLine });
          }),
        );
      }),
      Effect.tap(() => safeUpdate(options.onUpdate, { _tag: "StdoutClosed" })),
    );

    const stderrEffect = collectText(handle.stderr);
    const exitCodeEffect = handle.exitCode.pipe(
      Effect.tap((exitCode) =>
        safeUpdate(options.onUpdate, {
          _tag: "ProcessExited",
          exitCode: Number(exitCode),
        }),
      ),
    );

    const [, stderr, exitCode] = yield* Effect.all(
      [consumeStdout, stderrEffect, exitCodeEffect] as const,
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new CodeRabbitExecutionError("CodeRabbit output streaming failed.", {
            repositoryRoot,
            stderr: String(cause),
            errors,
            malformedLines,
          }),
      ),
    );

    const numericExitCode = Number(exitCode);

    if (errors.length > 0) {
      return yield* Effect.fail(
        new CodeRabbitExecutionError(
          errors.map((event) => event.message ?? "CodeRabbit reported an error.").join("\n"),
          {
            repositoryRoot,
            exitCode: numericExitCode,
            stderr: stderr.trim(),
            errors,
            malformedLines,
          },
        ),
      );
    }

    if (numericExitCode !== 0) {
      return yield* Effect.fail(
        new CodeRabbitExecutionError(`CodeRabbit exited with status ${numericExitCode}.`, {
          repositoryRoot,
          exitCode: numericExitCode,
          stderr: stderr.trim(),
          malformedLines,
        }),
      );
    }

    if (complete === undefined) {
      return yield* Effect.fail(
        new CodeRabbitExecutionError(
          "CodeRabbit exited without emitting the required `complete` event.",
          {
            repositoryRoot,
            exitCode: numericExitCode,
            stderr: stderr.trim(),
            malformedLines,
          },
        ),
      );
    }

    return {
      request: options.request,
      repositoryRoot,
      findings,
      complete,
      errors,
      unknownEvents,
      malformedLines,
      stderr: stderr.trim(),
      exitCode: numericExitCode,
    } satisfies ReviewResult;
  }).pipe(Effect.scoped);
