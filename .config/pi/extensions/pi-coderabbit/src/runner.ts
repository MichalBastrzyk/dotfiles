import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
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
const TEMPORARY_COMMIT_MESSAGE = "pi-coderabbit: temporary staged review";
const executeFile = promisify(execFile);

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

const runGit = Effect.fn("pi-coderabbit.runGit")(function* (
  cwd: string,
  args: ReadonlyArray<string>,
  env?: Readonly<Record<string, string>>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner
    .spawn(
      ChildProcess.make("git", args, {
        cwd,
        env,
        extendEnv: true,
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

  return { stdout, stderr, exitCode: Number(exitCode) };
});

const resolveRepositoryRoot = Effect.fn("pi-coderabbit.resolveRepositoryRoot")(function* (cwd: string) {
  const result = yield* runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const root = result.stdout.trim();

  if (result.exitCode !== 0 || root.length === 0) {
    return yield* Effect.fail(
      new CodeRabbitExecutionError("The current directory is not inside a Git repository.", {
        exitCode: result.exitCode,
        stderr: result.stderr.trim(),
      }),
    );
  }

  return root;
});

interface StagedSnapshotResource {
  readonly repositoryRoot: string;
  readonly temporaryRoot: string;
  readonly worktreePath: string;
  readonly hooksPath: string;
}

const cleanupStagedSnapshot = (resource: StagedSnapshotResource) =>
  Effect.promise(async () => {
    try {
      await executeFile(
        "git",
        ["worktree", "remove", "--force", "--force", resource.worktreePath],
        { cwd: resource.repositoryRoot, timeout: 5_000 },
      );
    } catch {
      // Filesystem cleanup below still removes the isolated checkout.
    }
    try {
      await rm(resource.temporaryRoot, { recursive: true, force: true });
    } catch {
      // The temporary directory stays behind; the OS reclaims it later.
    }
  });

const acquireStagedSnapshot = Effect.fn("pi-coderabbit.acquireStagedSnapshot")(function* (
  repositoryRoot: string,
) {
  const resource = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-coderabbit-staged-"));
        try {
          const snapshotName = basename(temporaryRoot);
          const hooksPath = join(temporaryRoot, "hooks");
          await mkdir(hooksPath);
          return {
            repositoryRoot,
            temporaryRoot,
            worktreePath: join(temporaryRoot, snapshotName),
            hooksPath,
          } satisfies StagedSnapshotResource;
        } catch (error) {
          await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
          throw error;
        }
      },
      catch: (cause) => platformFailure("Creating a temporary staged review directory", cause),
    }),
    cleanupStagedSnapshot,
  );

  const stagedDiff = yield* runGit(repositoryRoot, ["diff", "--cached", "--quiet", "--exit-code", "--"]);
  if (stagedDiff.exitCode === 0) {
    return yield* Effect.fail(
      new CodeRabbitExecutionError("There are no staged changes to review.", { repositoryRoot }),
    );
  }
  if (stagedDiff.exitCode !== 1) {
    return yield* Effect.fail(
      new CodeRabbitExecutionError("Could not inspect staged Git changes.", {
        repositoryRoot,
        exitCode: stagedDiff.exitCode,
        stderr: stagedDiff.stderr.trim(),
      }),
    );
  }

  const tree = yield* runGit(repositoryRoot, ["write-tree"]);
  if (tree.exitCode !== 0 || tree.stdout.trim().length === 0) {
    return yield* Effect.fail(
      new CodeRabbitExecutionError("Could not create a Git tree from the staged changes.", {
        repositoryRoot,
        exitCode: tree.exitCode,
        stderr: tree.stderr.trim(),
      }),
    );
  }

  const head = yield* runGit(repositoryRoot, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (head.exitCode !== 0 && head.exitCode !== 1) {
    return yield* Effect.fail(
      new CodeRabbitExecutionError("Could not resolve the current Git commit.", {
        repositoryRoot,
        exitCode: head.exitCode,
        stderr: head.stderr.trim(),
      }),
    );
  }

  const parent = head.exitCode === 0 ? ["-p", head.stdout.trim()] : [];
  const commit = yield* runGit(
    repositoryRoot,
    ["commit-tree", tree.stdout.trim(), ...parent, "-m", TEMPORARY_COMMIT_MESSAGE],
    {
      GIT_AUTHOR_NAME: "Pi CodeRabbit",
      GIT_AUTHOR_EMAIL: "pi-coderabbit@localhost",
      GIT_COMMITTER_NAME: "Pi CodeRabbit",
      GIT_COMMITTER_EMAIL: "pi-coderabbit@localhost",
    },
  );
  if (commit.exitCode !== 0 || commit.stdout.trim().length === 0) {
    return yield* Effect.fail(
      new CodeRabbitExecutionError("Could not create the temporary staged review commit.", {
        repositoryRoot,
        exitCode: commit.exitCode,
        stderr: commit.stderr.trim(),
      }),
    );
  }

  const worktree = yield* runGit(repositoryRoot, [
    "-c",
    `core.hooksPath=${resource.hooksPath}`,
    "worktree",
    "add",
    "--detach",
    resource.worktreePath,
    commit.stdout.trim(),
  ]);
  if (worktree.exitCode !== 0) {
    return yield* Effect.fail(
      new CodeRabbitExecutionError("Could not check out the temporary staged review commit.", {
        repositoryRoot,
        exitCode: worktree.exitCode,
        stderr: worktree.stderr.trim(),
      }),
    );
  }

  return resource.worktreePath;
});

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

const executeCodeRabbit = Effect.fn("pi-coderabbit.executeCodeRabbit")(function* (
  options: ReviewRunnerOptions,
  repositoryRoot: string,
  executionRoot: string,
) {
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
        cwd: executionRoot,
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
});

export const runCodeRabbitReview = (options: ReviewRunnerOptions) =>
  Effect.gen(function* () {
    const repositoryRoot = yield* resolveRepositoryRoot(options.cwd);
    yield* safeUpdate(options.onUpdate, { _tag: "RepositoryResolved", repositoryRoot });

    const executionRoot =
      options.request.scope.kind === "staged"
        ? yield* acquireStagedSnapshot(repositoryRoot)
        : repositoryRoot;

    return yield* executeCodeRabbit(options, repositoryRoot, executionRoot);
  }).pipe(Effect.scoped);
