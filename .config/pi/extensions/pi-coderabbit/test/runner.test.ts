import { NodeServices } from "@effect/platform-node";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewRequest } from "../src/domain.ts";
import { runCodeRabbitReview } from "../src/runner.ts";

const executeFile = promisify(execFile);
const temporaryDirectories: string[] = [];

const git = async (cwd: string, args: ReadonlyArray<string>): Promise<string> =>
  (await executeFile("git", args, { cwd })).stdout.trim();

const createRepository = async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-coderabbit-runner-test-"));
  temporaryDirectories.push(root);
  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await writeFile(join(root, "example.txt"), "base\n");
  await git(root, ["add", "example.txt"]);
  await git(root, ["commit", "--quiet", "-m", "initial"]);
  return realpath(root);
};

const createUnbornRepository = async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-coderabbit-runner-test-"));
  temporaryDirectories.push(root);
  await git(root, ["init", "--quiet"]);
  return realpath(root);
};

const stagedRequest: ReviewRequest = {
  light: false,
  scope: { kind: "staged" },
};

afterEach(async () => {
  delete process.env.PI_CODERABBIT_TEST_CAPTURE;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("staged review runner", () => {
  it("reviews a temporary commit without changing the working tree, index, or HEAD", async () => {
    const repositoryRoot = await createRepository();
    await writeFile(join(repositoryRoot, "example.txt"), "base\nstaged\n");
    await git(repositoryRoot, ["add", "example.txt"]);
    await writeFile(join(repositoryRoot, "example.txt"), "base\nstaged\nunstaged\n");
    await writeFile(join(repositoryRoot, "secret.txt"), "not staged\n");
    const checkoutHook = join(repositoryRoot, ".git", "hooks", "post-checkout");
    await writeFile(checkoutHook, `#!/bin/sh\ntouch '${join(repositoryRoot, "hook-ran")}'\n`);
    await chmod(checkoutHook, 0o755);

    const bin = join(repositoryRoot, "fake-bin");
    const capture = join(repositoryRoot, "capture");
    await mkdir(bin);
    await mkdir(capture);
    const executable = join(bin, "coderabbit");
    await writeFile(
      executable,
      [
        "#!/bin/sh",
        "set -eu",
        'printf "%s\\n" "$PWD" > "$PI_CODERABBIT_TEST_CAPTURE/cwd"',
        'printf "%s\\n" "$@" > "$PI_CODERABBIT_TEST_CAPTURE/args"',
        'cat example.txt > "$PI_CODERABBIT_TEST_CAPTURE/file"',
        'if [ -e secret.txt ]; then echo present; else echo absent; fi > "$PI_CODERABBIT_TEST_CAPTURE/untracked"',
        'git log -1 --pretty=%s > "$PI_CODERABBIT_TEST_CAPTURE/commit-message"',
        "printf '%s\\n' '{\"type\":\"complete\",\"status\":\"completed\",\"findings\":0}'",
      ].join("\n"),
    );
    await chmod(executable, 0o755);

    const before = {
      head: await git(repositoryRoot, ["rev-parse", "HEAD"]),
      staged: await git(repositoryRoot, ["diff", "--cached", "--binary"]),
      unstaged: await git(repositoryRoot, ["diff", "--binary"]),
      status: await git(repositoryRoot, ["status", "--short", "--untracked-files=no"]),
      worktrees: await git(repositoryRoot, ["worktree", "list", "--porcelain"]),
    };
    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    process.env.PI_CODERABBIT_TEST_CAPTURE = capture;

    try {
      const result = await Effect.runPromise(
        runCodeRabbitReview({ cwd: repositoryRoot, request: stagedRequest }).pipe(
          Effect.provide(NodeServices.layer),
        ),
      );

      expect(result.repositoryRoot).toBe(repositoryRoot);
      expect((await readFile(join(capture, "args"), "utf8")).trim().split("\n")).toEqual([
        "review",
        "--agent",
        "--committed",
      ]);
      expect(await readFile(join(capture, "file"), "utf8")).toBe("base\nstaged\n");
      expect((await readFile(join(capture, "untracked"), "utf8")).trim()).toBe("absent");
      expect((await readFile(join(capture, "commit-message"), "utf8")).trim()).toBe(
        "pi-coderabbit: temporary staged review",
      );
      expect((await readFile(join(capture, "cwd"), "utf8")).trim()).not.toBe(repositoryRoot);
      await expect(readFile(join(repositoryRoot, "hook-ran"), "utf8")).rejects.toThrow();
    } finally {
      process.env.PATH = originalPath;
    }

    expect({
      head: await git(repositoryRoot, ["rev-parse", "HEAD"]),
      staged: await git(repositoryRoot, ["diff", "--cached", "--binary"]),
      unstaged: await git(repositoryRoot, ["diff", "--binary"]),
      status: await git(repositoryRoot, ["status", "--short", "--untracked-files=no"]),
      worktrees: await git(repositoryRoot, ["worktree", "list", "--porcelain"]),
    }).toEqual(before);
  });

  it("removes the temporary worktree when the review is cancelled", async () => {
    const repositoryRoot = await createRepository();
    await writeFile(join(repositoryRoot, "example.txt"), "base\nstaged\n");
    await git(repositoryRoot, ["add", "example.txt"]);

    const bin = join(repositoryRoot, "fake-bin");
    await mkdir(bin);
    const executable = join(bin, "coderabbit");
    await writeFile(executable, "#!/bin/sh\nexec sleep 30\n");
    await chmod(executable, 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    const controller = new AbortController();
    let processStarted = () => {};
    const started = new Promise<void>((resolve) => {
      processStarted = resolve;
    });

    try {
      const review = Effect.runPromise(
        runCodeRabbitReview({
          cwd: repositoryRoot,
          request: stagedRequest,
          onUpdate: (update) => {
            if (update._tag === "ProcessStarted") processStarted();
          },
        }).pipe(Effect.provide(NodeServices.layer)),
        { signal: controller.signal },
      );
      await started;
      controller.abort();
      await expect(review).rejects.toThrow();
    } finally {
      process.env.PATH = originalPath;
    }

    expect(await git(repositoryRoot, ["worktree", "list", "--porcelain"])).not.toContain(
      "pi-coderabbit-staged-",
    );
  });

  it("reviews staged files in a repository without an existing commit", async () => {
    const repositoryRoot = await createUnbornRepository();
    await writeFile(join(repositoryRoot, "example.txt"), "first version\n");
    await git(repositoryRoot, ["add", "example.txt"]);
    const stagedBefore = await git(repositoryRoot, ["diff", "--cached", "--binary"]);

    const bin = join(repositoryRoot, "fake-bin");
    const capture = join(repositoryRoot, "capture");
    await mkdir(bin);
    await mkdir(capture);
    const executable = join(bin, "coderabbit");
    await writeFile(
      executable,
      [
        "#!/bin/sh",
        'git rev-list --parents -n 1 HEAD > "$PI_CODERABBIT_TEST_CAPTURE/commit"',
        "printf '%s\\n' '{\"type\":\"complete\",\"status\":\"completed\",\"findings\":0}'",
      ].join("\n"),
    );
    await chmod(executable, 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    process.env.PI_CODERABBIT_TEST_CAPTURE = capture;
    try {
      await Effect.runPromise(
        runCodeRabbitReview({ cwd: repositoryRoot, request: stagedRequest }).pipe(
          Effect.provide(NodeServices.layer),
        ),
      );
    } finally {
      process.env.PATH = originalPath;
    }

    expect((await readFile(join(capture, "commit"), "utf8")).trim().split(" ")).toHaveLength(1);
    await expect(git(repositoryRoot, ["rev-parse", "--verify", "HEAD"])).rejects.toThrow();
    expect(await git(repositoryRoot, ["diff", "--cached", "--binary"])).toBe(stagedBefore);
    expect(await git(repositoryRoot, ["worktree", "list", "--porcelain"])).not.toContain(
      "pi-coderabbit-staged-",
    );
  });

  it("fails before starting CodeRabbit when nothing is staged", async () => {
    const repositoryRoot = await createRepository();

    await expect(
      Effect.runPromise(
        runCodeRabbitReview({ cwd: repositoryRoot, request: stagedRequest }).pipe(
          Effect.provide(NodeServices.layer),
        ),
      ),
    ).rejects.toThrow("There are no staged changes to review.");

    expect(await git(repositoryRoot, ["worktree", "list", "--porcelain"])).not.toContain(
      "pi-coderabbit-staged-",
    );
  });
});
