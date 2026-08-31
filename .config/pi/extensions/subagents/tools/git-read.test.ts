import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildGitArguments,
  parseGitCommand,
  runGit,
  tokenizeGitCommand,
  validateGitInvocation,
} from "./git-read.ts";

const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "git-read-tool-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ── Command parsing (no git needed) ──────────────────────────────────

describe("git_read command parsing", () => {
  it("parses a plain command line into subcommand and args", () => {
    expect(parseGitCommand("diff --stat HEAD~1")).toEqual({
      ok: true,
      subcommand: "diff",
      args: ["--stat", "HEAD~1"],
    });
    expect(parseGitCommand("status")).toEqual({ ok: true, subcommand: "status", args: [] });
  });

  it("accepts a leading git prefix", () => {
    expect(parseGitCommand("git diff --stat")).toEqual({
      ok: true,
      subcommand: "diff",
      args: ["--stat"],
    });
    expect(parseGitCommand("  git   log -n 3 ")).toEqual({
      ok: true,
      subcommand: "log",
      args: ["-n", "3"],
    });
  });

  it("handles quotes and backslash escapes without a shell", () => {
    const parsed = parseGitCommand(`diff -- "file with spaces.ts"`);
    expect(parsed).toEqual({ ok: true, subcommand: "diff", args: ["--", "file with spaces.ts"] });
    const grep = parseGitCommand(`log --grep='user story' --oneline`);
    expect(grep).toEqual({
      ok: true,
      subcommand: "log",
      args: ["--grep=user story", "--oneline"],
    });
  });

  it("rejects shell features with an explanatory error", () => {
    for (const command of [
      "diff HEAD~1 | head",
      "log > log.txt",
      "status && echo hi",
      "log --format=`%h`",
      "diff $(git rev-parse HEAD)",
      "log --grep='unterminated",
    ]) {
      const parsed = parseGitCommand(command);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error).toMatch(/not supported|unterminated quote/i);
        expect(parsed.error).toContain("Pass the command as one string");
      }
    }
  });

  it("rejects empty commands", () => {
    const parsed = parseGitCommand("   ");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/empty command/);
  });

  it("tokenizes shell metacharacters only outside quotes", () => {
    // ">" inside quotes is a literal format character and must be accepted.
    const parsed = parseGitCommand(`log --format="<%h> %s"`);
    expect(parsed).toEqual({ ok: true, subcommand: "log", args: ["--format=<%h> %s"] });
  });

  it("adds --no-ext-diff/--no-textconv only for diff-family commands, before user args", () => {
    expect(buildGitArguments("diff", ["--stat"])).toEqual(["diff", "--no-ext-diff", "--no-textconv", "--stat"]);
    expect(buildGitArguments("diff", ["HEAD~1", "--", "src/"])).toEqual([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "HEAD~1",
      "--",
      "src/",
    ]);
    expect(buildGitArguments("log", ["-n", "1"])).toEqual(["log", "--no-ext-diff", "--no-textconv", "-n", "1"]);
    expect(buildGitArguments("status", [])).toEqual(["status"]);
    expect(buildGitArguments("ls-files", [])).toEqual(["ls-files"]);
  });
});

// ── Validation (no git needed) ───────────────────────────────────────

describe("git_read validation", () => {
  it("accepts read-only subcommands with typical args", () => {
    expect(validateGitInvocation("status", [])).toBeNull();
    expect(validateGitInvocation("diff", ["--stat"])).toBeNull();
    expect(validateGitInvocation("diff", ["HEAD~1", "--", "src/"])).toBeNull();
    expect(validateGitInvocation("log", ["-n", "20", "--oneline"])).toBeNull();
    expect(validateGitInvocation("show", ["abc123"])).toBeNull();
    expect(validateGitInvocation("blame", ["src/app.ts"])).toBeNull();
    expect(validateGitInvocation("grep", ["-n", "TODO"])).toBeNull();
    expect(validateGitInvocation("rev-parse", ["HEAD"])).toBeNull();
  });

  it("rejects mutating subcommands outright", () => {
    for (const sub of ["checkout", "commit", "reset", "push", "pull", "fetch", "merge", "rebase", "clean", "restore", "switch", "stash", "init", "clone", "tag"]) {
      expect(validateGitInvocation(sub, [])).toMatch(`git subcommand "${sub}" is not allowed`);
    }
  });

  it("rejects --output file writes", () => {
    expect(validateGitInvocation("diff", ["--output=out.patch"])).toMatch("writes diff output to a file");
    expect(validateGitInvocation("log", ["--output", "log.txt"])).toMatch("writes diff output to a file");
  });

  it("rejects NUL bytes", () => {
    expect(validateGitInvocation("log", ["a\0b"])).toMatch("NUL byte");
  });

  it("blocks branch creation and deletion", () => {
    expect(validateGitInvocation("branch", ["feature"])).toMatch("would create a branch");
    expect(validateGitInvocation("branch", ["-d", "feature"])).toMatch("modifies branches");
    expect(validateGitInvocation("branch", ["-D", "feature"])).toMatch("modifies branches");
    expect(validateGitInvocation("branch", ["--delete", "feature"])).toMatch("modifies branches");
  });

  it("allows branch listing and filters", () => {
    expect(validateGitInvocation("branch", [])).toBeNull();
    expect(validateGitInvocation("branch", ["-a", "-v"])).toBeNull();
    expect(validateGitInvocation("branch", ["--merged", "main"])).toBeNull();
    expect(validateGitInvocation("branch", ["--contains", "abc123"])).toBeNull();
  });

  it("blocks remote mutation but allows queries", () => {
    expect(validateGitInvocation("remote", ["add", "origin", "https://x"])).toMatch("modifies remote configuration");
    expect(validateGitInvocation("remote", ["set-url", "origin", "https://x"])).toMatch("modifies remote configuration");
    expect(validateGitInvocation("remote", ["prune"])).toMatch("modifies remote configuration");
    expect(validateGitInvocation("remote", [])).toBeNull();
    expect(validateGitInvocation("remote", ["-v"])).toBeNull();
    expect(validateGitInvocation("remote", ["show", "origin"])).toBeNull();
    expect(validateGitInvocation("remote", ["get-url", "origin"])).toBeNull();
  });

  it("allows read-only plumbing subcommands", () => {
    expect(validateGitInvocation("ls-tree", ["-r", "HEAD", "src"])).toBeNull();
    expect(validateGitInvocation("ls-files", [])).toBeNull();
    expect(validateGitInvocation("for-each-ref", ["refs/heads"])).toBeNull();
    expect(validateGitInvocation("merge-base", ["HEAD", "main"])).toBeNull();
    expect(validateGitInvocation("rev-list", ["--count", "HEAD"])).toBeNull();
  });
});

// ── Integration (real git in a temp repository) ──────────────────────

describe("git_read integration", () => {
  function makeRepository() {
    const directory = temporaryDirectory();
    git(directory, "init", "-b", "main", "-q");
    git(directory, "config", "user.email", "test@example.com");
    git(directory, "config", "user.name", "Test");
    fs.writeFileSync(path.join(directory, "hello.txt"), "line one\n");
    git(directory, "add", "hello.txt");
    git(directory, "commit", "-q", "-m", "initial commit");
    return directory;
  }

  function git(cwd: string, ...args: string[]) {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
  }

  // Mirrors the tool's execute(): parse -> validate -> build -> run.
  async function gitRead(repo: string, command: string) {
    const parsed = parseGitCommand(command);
    if (!parsed.ok) throw new Error(parsed.error);
    const violation = validateGitInvocation(parsed.subcommand, parsed.args);
    if (violation) throw new Error(violation);
    return runGit(repo, buildGitArguments(parsed.subcommand, parsed.args));
  }

  it("reports clean status and file changes from the command string", async () => {
    const repo = makeRepository();

    const clean = await gitRead(repo, "status");
    expect(clean.exitCode).toBe(0);
    expect(clean.stdout).toMatch(/nothing to commit, working tree clean/);

    fs.writeFileSync(path.join(repo, "hello.txt"), "line one\nline two added\n");
    const dirty = await gitRead(repo, "diff");
    expect(dirty.exitCode).toBe(0);
    expect(dirty.stdout).toContain("+line two added");
  });

  it("runs diff with a pathspec from the command string", async () => {
    const repo = makeRepository();
    fs.writeFileSync(path.join(repo, "hello.txt"), "line one\nanother line\n");

    const result = await gitRead(repo, "diff hello.txt");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("+another line");
  });

  it("lists recent commits and blame", async () => {
    const repo = makeRepository();

    const log = await gitRead(repo, "log -n 1 --oneline");
    expect(log.exitCode).toBe(0);
    expect(log.stdout).toContain("initial commit");

    const blame = await gitRead(repo, "blame hello.txt");
    expect(blame.exitCode).toBe(0);
    expect(blame.stdout).toContain("line one");
  });

  it("surfaces git errors with the exit status", async () => {
    const repo = makeRepository();
    const result = await gitRead(repo, "show nonexistent-rev");
    expect(result.exitCode).not.toBe(0);
  });

  it("never lets blocked invocations reach git", async () => {
    const repo = makeRepository();
    await expect(gitRead(repo, "checkout main")).rejects.toThrow("not allowed");
    await expect(gitRead(repo, "branch feature")).rejects.toThrow("would create a branch");
    await expect(gitRead(repo, "diff --output=out.patch")).rejects.toThrow("writes diff output");
  });
});