import { NodeServices } from "@effect/platform-node";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Cause, Data, Effect, Exit, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";

const EXECUTION_TIMEOUT_MS = 120_000;
const MAX_STDOUT_CHARACTERS = 16_000;
const MAX_STDERR_CHARACTERS = 8_000;

export class OpenSrcError extends Data.TaggedError("OpenSrcError")<{
  readonly message: string;
  readonly exitCode?: number;
  readonly stderr?: string;
}> {}

export type OpenSrcResolution = "project-lockfile" | "explicit" | "latest";

export interface OpenSrcRequest {
  readonly source: string;
  readonly resolution: OpenSrcResolution;
  readonly executionCwd: string;
  readonly projectCwd?: string;
}

export interface OpenSrcOptions {
  readonly command?: string;
  readonly timeoutMs?: number;
}

export interface OpenSrcResult {
  readonly source: string;
  readonly path: string;
  readonly resolution: OpenSrcResolution;
  readonly projectCwd?: string;
  readonly resolvedPackage?: string;
  readonly resolvedVersion?: string;
  readonly opensrcVersion: string;
}

const collectText = (stream: Stream.Stream<Uint8Array, unknown>, maxCharacters: number) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (accumulator, chunk) => {
        const combined = accumulator + chunk;
        return combined.length <= maxCharacters
          ? combined
          : combined.slice(combined.length - maxCharacters);
      },
    ),
  );

export function buildOpenSrcArguments(source: string, projectCwd?: string): string[] {
  return ["path", ...(projectCwd ? ["--cwd", projectCwd] : []), source];
}

function validateDirectory(directory: string, label: string) {
  return Effect.try({
    try: () => {
      if (!fs.statSync(directory).isDirectory()) throw new Error("not a directory");
      return fs.realpathSync(directory);
    },
    catch: () => new OpenSrcError({ message: `${label} is not a directory: ${directory}` }),
  });
}

export function runOpenSrc(
  request: OpenSrcRequest,
  options: OpenSrcOptions = {},
): Effect.Effect<OpenSrcResult, OpenSrcError, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    const source = request.source.trim();
    if (!source || source.startsWith("-") || /[\0\r\n]/.test(source)) {
      return yield* new OpenSrcError({ message: "source must be a non-empty package or repository spec." });
    }
    if (request.resolution === "project-lockfile" && !request.projectCwd) {
      return yield* new OpenSrcError({
        message: "project-lockfile resolution requires a project directory.",
      });
    }
    if (request.resolution !== "project-lockfile" && request.projectCwd) {
      return yield* new OpenSrcError({
        message: `${request.resolution} resolution must not include a project directory.`,
      });
    }

    const executionCwd = yield* validateDirectory(request.executionCwd, "Working directory");
    const projectCwd = request.projectCwd
      ? yield* validateDirectory(request.projectCwd, "Project directory")
      : undefined;

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner
      .spawn(
        ChildProcess.make(
          options.command ?? "opensrc",
          buildOpenSrcArguments(source, projectCwd),
          {
            cwd: executionCwd,
            env: { NO_COLOR: "1" },
            extendEnv: true,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            shell: false,
            forceKillAfter: "5 seconds",
          },
        ),
      )
      .pipe(
        Effect.mapError(
          (error) =>
            new OpenSrcError({
              message: "Could not start opensrc. Confirm it is installed and available on PATH.",
              stderr: String(error),
            }),
        ),
      );

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectText(handle.stdout, MAX_STDOUT_CHARACTERS),
        collectText(handle.stderr, MAX_STDERR_CHARACTERS),
        handle.exitCode,
      ] as const,
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (error) =>
          new OpenSrcError({
            message: "Could not read opensrc output.",
            stderr: String(error),
          }),
      ),
    );

    const numericExitCode = Number(exitCode);
    if (numericExitCode !== 0) {
      const detail = stderr.trim();
      return yield* new OpenSrcError({
        message: detail
          ? `opensrc exited with status ${numericExitCode}: ${detail}`
          : `opensrc exited with status ${numericExitCode}.`,
        exitCode: numericExitCode,
        stderr: detail || undefined,
      });
    }

    const resolvedPath = stdout.trim();
    if (!resolvedPath || resolvedPath.includes("\n") || !path.isAbsolute(resolvedPath)) {
      return yield* new OpenSrcError({
        message: "opensrc returned an invalid source path.",
        stderr: stderr.trim() || undefined,
      });
    }

    const sourcePath = yield* validateDirectory(resolvedPath, "Resolved source path");
    const metadata = yield* Effect.sync(() => {
      try {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(sourcePath, "package.json"), "utf8"),
        ) as { name?: unknown; version?: unknown };
        return {
          name: typeof manifest.name === "string" ? manifest.name : undefined,
          version: typeof manifest.version === "string" ? manifest.version : undefined,
        };
      } catch {
        return {};
      }
    });

    const versionHandle = yield* spawner
      .spawn(
        ChildProcess.make(options.command ?? "opensrc", ["--version"], {
          cwd: executionCwd,
          env: { NO_COLOR: "1" },
          extendEnv: true,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          shell: false,
          forceKillAfter: "5 seconds",
        }),
      )
      .pipe(
        Effect.mapError(
          (error) =>
            new OpenSrcError({
              message: "Could not inspect the opensrc CLI version.",
              stderr: String(error),
            }),
        ),
      );
    const [versionStdout, versionStderr, versionExitCode] = yield* Effect.all(
      [
        collectText(versionHandle.stdout, 1_000),
        collectText(versionHandle.stderr, 1_000),
        versionHandle.exitCode,
      ] as const,
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (error) =>
          new OpenSrcError({
            message: "Could not read the opensrc CLI version.",
            stderr: String(error),
          }),
      ),
    );
    if (Number(versionExitCode) !== 0 || !versionStdout.trim()) {
      return yield* new OpenSrcError({
        message: "opensrc --version failed.",
        exitCode: Number(versionExitCode),
        stderr: versionStderr.trim() || undefined,
      });
    }

    return {
      source,
      path: sourcePath,
      resolution: request.resolution,
      projectCwd,
      resolvedPackage: metadata.name,
      resolvedVersion: metadata.version,
      opensrcVersion: versionStdout.trim().replace(/^opensrc\s+/i, ""),
    };
  }).pipe(
    Effect.scoped,
    Effect.timeout(options.timeoutMs ?? EXECUTION_TIMEOUT_MS),
    Effect.mapError((error) => {
      if (error instanceof OpenSrcError) return error;
      return new OpenSrcError({
        message:
          error._tag === "TimeoutError"
            ? "opensrc timed out."
            : error instanceof Error
              ? error.message
              : String(error),
      });
    }),
  );
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "opensrc",
    label: "Open Source",
    description:
      "Resolve and fetch upstream package or repository source with opensrc. Pass cwd only to select the version installed by that project's lockfile.",
    parameters: Type.Object({
      source: Type.String({
        description: "Package or repository spec, such as zod, zod@3.22.0, pypi:flask, or owner/repository@tag",
      }),
      resolution: Type.Union(
        [
          Type.Literal("project-lockfile"),
          Type.Literal("explicit"),
          Type.Literal("latest"),
        ],
        {
          description: "How the source version was selected. project-lockfile requires cwd; explicit and latest must omit cwd.",
        },
      ),
      cwd: Type.Optional(
        Type.String({
          description: "Project root used for installed-version lockfile resolution. Omit when inspecting latest or an explicit version.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const projectCwd = params.cwd ? path.resolve(ctx.cwd, params.cwd) : undefined;
      const exit = await Effect.runPromiseExit(
        runOpenSrc({
          source: params.source,
          resolution: params.resolution,
          executionCwd: ctx.cwd,
          projectCwd,
        }).pipe(Effect.provide(NodeServices.layer)),
        signal ? { signal } : undefined,
      );

      if (Exit.isFailure(exit)) {
        if (Cause.hasInterruptsOnly(exit.cause)) throw new Error("opensrc was aborted.");
        const [first] = Cause.prettyErrors(exit.cause);
        throw new Error(first?.message ?? Cause.pretty(exit.cause));
      }

      const result = exit.value;
      return {
        content: [
          {
            type: "text",
            text: [
              `Source: ${result.source}`,
              `Path: ${result.path}`,
              `Resolution: ${result.resolution}`,
              ...(result.projectCwd ? [`Project: ${result.projectCwd}`] : []),
              ...(result.resolvedPackage ? [`Package: ${result.resolvedPackage}`] : []),
              ...(result.resolvedVersion ? [`Version: ${result.resolvedVersion}`] : []),
              `opensrc CLI: ${result.opensrcVersion}`,
            ].join("\n"),
          },
        ],
        details: result,
      };
    },
  });
}
