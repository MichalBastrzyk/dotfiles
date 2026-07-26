import { NodeServices } from "@effect/platform-node";
import { afterEach, describe, expect, it } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildOpenSrcArguments,
  runOpenSrc,
  type OpenSrcOptions,
  type OpenSrcResolution,
} from "./opensrc.ts";

const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opensrc-tool-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function fakeOpenSrc(body: string) {
  const directory = temporaryDirectory();
  const executable = path.join(directory, "opensrc");
  fs.writeFileSync(executable, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
  return executable;
}

function execute(
  source: string,
  options: OpenSrcOptions = {},
  projectCwd?: string,
  resolution: OpenSrcResolution = projectCwd ? "project-lockfile" : "latest",
) {
  return Effect.runPromise(
    runOpenSrc(
      { source, resolution, executionCwd: process.cwd(), projectCwd },
      options,
    ).pipe(Effect.provide(NodeServices.layer)),
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("opensrc tool", () => {
  it("builds latest and project-lockfile argument lists", () => {
    expect(buildOpenSrcArguments("zod")).toEqual(["path", "zod"]);
    expect(buildOpenSrcArguments("zod", "/project")).toEqual([
      "path",
      "--cwd",
      "/project",
      "zod",
    ]);
  });

  it("returns a canonical absolute source directory", async () => {
    const sourceDirectory = temporaryDirectory();
    fs.writeFileSync(
      path.join(sourceDirectory, "package.json"),
      JSON.stringify({ name: "zod", version: "4.0.0" }),
    );
    const command = fakeOpenSrc(
      `if [ "$1" = "--version" ]; then printf 'opensrc 0.7.3\\n'; else printf '%s\\n' '${sourceDirectory}'; fi`,
    );

    await expect(execute("zod", { command })).resolves.toEqual({
      source: "zod",
      path: fs.realpathSync(sourceDirectory),
      resolution: "latest",
      projectCwd: undefined,
      resolvedPackage: "zod",
      resolvedVersion: "4.0.0",
      opensrcVersion: "0.7.3",
    });
  });

  it("rejects option-like source specs", async () => {
    await expect(execute("--help")).rejects.toThrow("source must be");
  });

  it("enforces resolution and cwd consistency", async () => {
    await expect(
      execute("zod", { command: "/does/not/matter" }, undefined, "project-lockfile"),
    ).rejects.toThrow("project-lockfile resolution requires a project directory");
    await expect(
      execute("zod", { command: "/does/not/matter" }, process.cwd(), "latest"),
    ).rejects.toThrow("latest resolution must not include a project directory");
  });

  it("rejects an invalid project directory before spawning", async () => {
    await expect(
      execute("zod", { command: "/does/not/matter" }, "/missing/project"),
    ).rejects.toThrow("Project directory is not a directory");
  });

  it("reports a missing opensrc executable", async () => {
    await expect(
      execute("zod", { command: "/missing/opensrc-test-executable" }),
    ).rejects.toThrow("Could not start opensrc");
  });

  it("reports bounded nonzero-exit stderr", async () => {
    const command = fakeOpenSrc("printf 'package not found\\n' >&2; exit 7");

    await expect(execute("missing-package", { command })).rejects.toThrow(
      "opensrc exited with status 7: package not found",
    );
  });

  it("rejects a relative source path", async () => {
    const command = fakeOpenSrc("printf 'relative/path\\n'");

    await expect(execute("zod", { command })).rejects.toThrow(
      "opensrc returned an invalid source path",
    );
  });

  it("interrupts and cleans up a timed-out process", async () => {
    const command = fakeOpenSrc("sleep 5");

    await expect(execute("zod", { command, timeoutMs: 20 })).rejects.toThrow(
      "opensrc timed out",
    );
  });

  it("honors an AbortSignal", async () => {
    const command = fakeOpenSrc("sleep 5");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    const exit = await Effect.runPromiseExit(
      runOpenSrc(
        { source: "zod", resolution: "latest", executionCwd: process.cwd() },
        { command },
      ).pipe(Effect.provide(NodeServices.layer)),
      { signal: controller.signal },
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  });
});
