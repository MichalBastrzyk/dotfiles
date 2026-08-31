/**
 * Read-only git inspection tool for the scout subagent.
 *
 * Accepts a plain command line string — `git_read { command: "diff --stat" }` —
 * exactly the way a human (or model) would type `git diff --stat`. The leading
 * `git` is optional. The command is tokenized in-process (no shell is ever
 * involved: no pipes, redirects, chaining, or substitution) and then executed
 * by spawning the `git` binary directly with an argument array.
 *
 * Only a fixed allowlist of read-only subcommands is accepted. The tool can
 * never stage, commit, checkout, reset, push, fetch, or otherwise modify
 * repository state, refs, the working tree, or the index. Invocations that
 * would mutate state are rejected before the process starts, with an error
 * that explains why and what to use instead.
 */
import { spawn } from "node:child_process";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const EXECUTION_TIMEOUT_MS = 120_000;
const MAX_STDOUT_CHARACTERS = 16_000;
const MAX_STDERR_CHARACTERS = 8_000;

export const READ_ONLY_SUBCOMMANDS = [
  "status",
  "diff",
  "log",
  "show",
  "blame",
  "grep",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "rev-list",
  "describe",
  "shortlog",
  "name-rev",
  "merge-base",
  "count-objects",
  "for-each-ref",
  "diff-tree",
  "diff-index",
  "diff-files",
  "remote",
  "branch",
] as const;

export type ReadOnlySubcommand = (typeof READ_ONLY_SUBCOMMANDS)[number];

// `git branch` flags that mutate branches.
const BRANCH_WRITE_FLAGS = new Set([
  "-d",
  "-D",
  "-m",
  "-M",
  "-c",
  "-C",
  "-f",
  "--delete",
  "--move",
  "--copy",
  "--edit-description",
  "--set-upstream-to",
  "--unset-upstream",
  "--force",
  "--orphan",
]);

// `git branch` flags that only list or filter branches. Positional arguments
// are allowed only alongside one of these, so `git branch <name>` (which
// creates a branch) can never reach git.
const BRANCH_LIST_FLAGS = new Set([
  "-a",
  "-r",
  "-v",
  "--all",
  "--remotes",
  "--verbose",
  "--contains",
  "--merged",
  "--no-merged",
  "--points-at",
  "--list",
  "--format",
  "--sort",
  "--no-color",
  "--show-current",
  "--column",
  "--ignore-case",
]);

const BRANCH_LIST_FLAG_PREFIXES = ["--contains=", "--merged=", "--no-merged=", "--points-at="];

// Subcommands that accept diff options and may honor external diff drivers or
// textconv. For these we append --no-ext-diff/--no-textconv so a repo or user
// config can never make git run an external program while "reading" a diff.
const DIFF_FAMILY = new Set(["diff", "log", "show", "blame", "diff-tree", "diff-index", "diff-files"]);

/**
 * Build the argv to spawn git with. Prepends --no-ext-diff/--no-textconv for
 * diff-family subcommands (git requires diff options to come before
 * non-option arguments), so a configured external diff driver or textconv can
 * never make git run an external program while inspecting a diff.
 */
export function buildGitArguments(subcommand: string, args: string[]): string[] {
  return DIFF_FAMILY.has(subcommand)
    ? [subcommand, "--no-ext-diff", "--no-textconv", ...args]
    : [subcommand, ...args];
}

// Sub-nouns of `git remote` that modify remote configuration.
const REMOTE_WRITE_NOUNS = new Set([
  "add",
  "rename",
  "remove",
  "set-url",
  "set-head",
  "set-branches",
  "prune",
  "update",
]);

export const INTERFACE_HINT =
  'Pass the command as one string, e.g. git_read { command: "diff packages/ui/package.json" }. No shell features are supported: no pipes, redirects, "&&", or "$(...)".';

/**
 * Tokenize a command line without a shell. Handles single quotes, double
 * quotes, and backslash escapes; rejects shell metacharacters outside quotes
 * with an explanatory error instead of attempting to interpret them.
 */
export function tokenizeGitCommand(command: string): { tokens: string[]; error: string | null } {
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  const n = command.length;

  const pushToken = () => {
    if (hasToken) {
      tokens.push(current);
      current = "";
      hasToken = false;
    }
  };
  const fail = (message: string) => ({ tokens: [], error: `${message} ${INTERFACE_HINT}` });

  while (i < n) {
    const ch = command[i];

    if (inSingle) {
      if (ch === "'") inSingle = false;
      else current += ch;
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      else current += ch;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      hasToken = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      hasToken = true;
      i++;
      continue;
    }
    if (ch === "\\") {
      if (i + 1 >= n) return fail("dangling backslash at end of the git_read command");
      current += command[i + 1];
      hasToken = true;
      i += 2;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n") {
      pushToken();
      i++;
      continue;
    }
    if (";|&<>".includes(ch)) {
      return fail(`shell feature "${ch}" is not supported in git_read commands`);
    }
    if (ch === "`") {
      return fail("backticks are not supported in git_read commands");
    }
    if (ch === "$" && i + 1 < n && (command[i + 1] === "(" || command[i + 1] === "{")) {
      return fail("command substitution is not supported in git_read commands");
    }
    current += ch;
    hasToken = true;
    i++;
  }
  if (inSingle || inDouble) return fail("unterminated quote in the git_read command");
  pushToken();
  return { tokens, error: null };
}

/**
 * Split a user-supplied git command line into a subcommand and its args.
 * The `command` may (optionally) start with `git`/`git_read`.
 */
export function parseGitCommand(command: string): { ok: true; subcommand: string; args: string[] } | { ok: false; error: string } {
  const trimmed = command.trim();
  const withoutPrefix = trimmed.startsWith("git ") ? trimmed.slice(4) : trimmed;
  const { tokens, error } = tokenizeGitCommand(withoutPrefix);
  if (error) return { ok: false, error };
  if (tokens.length === 0) return { ok: false, error: `git_read received an empty command. ${INTERFACE_HINT}` };
  return { ok: true, subcommand: tokens[0], args: tokens.slice(1) };
}

/**
 * Reject any invocation that is not provably read-only. Returns an error
 * message when the invocation must be blocked, otherwise null.
 */
export function validateGitInvocation(subcommand: string, args: string[]): string | null {
  if (!(READ_ONLY_SUBCOMMANDS as readonly string[]).includes(subcommand)) {
    return `git subcommand "${subcommand}" is not allowed (git_read is read-only). Allowed subcommands: ${READ_ONLY_SUBCOMMANDS.join(", ")}. If you meant a command like ${'"'}git ${subcommand} ...${'"'}, it would modify repository state and is rejected.`;
  }
  for (const arg of args) {
    if (arg.includes("\0")) return `argument contains a NUL byte and is not allowed.`;
    if (arg === "--output" || arg.startsWith("--output=")) {
      return `git flag "${arg}" writes diff output to a file and is not allowed.`;
    }
  }
  if (subcommand === "branch") {
    for (const arg of args) {
      if (BRANCH_WRITE_FLAGS.has(arg)) {
        return `git branch "${arg}" modifies branches and is not allowed. Use a listing flag such as -a, -r, -v, --merged, or --contains instead.`;
      }
    }
    const hasListFlag = args.some(
      (arg) =>
        BRANCH_LIST_FLAGS.has(arg) || BRANCH_LIST_FLAG_PREFIXES.some((prefix) => arg.startsWith(prefix)),
    );
    const hasPositional = args.some((arg) => !arg.startsWith("-"));
    if (hasPositional && !hasListFlag) {
      return `git branch with positional arguments is not allowed unless a listing flag (-a, -r, -v, --merged, --contains, ...) is present, because "git branch <name>" would create a branch.`;
    }
  }
  if (subcommand === "remote") {
    const noun = args.find((arg) => !arg.startsWith("-"));
    if (noun === undefined) return null; // `git remote` alone lists remotes.
    if (REMOTE_WRITE_NOUNS.has(noun)) {
      return `git remote ${noun} modifies remote configuration and is not allowed. Allowed: "git remote -v", "git remote show <name>", "git remote get-url <name>".`;
    }
    if (noun !== "show" && noun !== "get-url") {
      return `git remote ${noun} is not a read-only remote query. Allowed: "git remote -v", "git remote show <name>", "git remote get-url <name>".`;
    }
  }
  return null;
}

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export function runGit(
  cwd: string,
  args: string[],
  signal: AbortSignal | undefined,
  timeoutMs: number = EXECUTION_TIMEOUT_MS,
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_PAGER: "cat", NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
    const proc = spawn("git", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    proc.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_STDOUT_CHARACTERS) stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_CHARACTERS) stderr += chunk.toString();
    });

    const kill = () => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => !proc.killed && proc.kill("SIGKILL"), 3000);
    };
    const timer = setTimeout(kill, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1, timedOut });
    });

    if (signal) {
      if (signal.aborted) kill();
      else signal.addEventListener("abort", kill, { once: true });
    }
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "git_read",
    label: "Git Read",
    description:
      'Run a read-only git command. Pass the whole command as one string, exactly as you would type it after "git", e.g. "diff --stat", "log -n 20 --oneline", "show abc123", "blame src/app.ts", or "status". The leading "git" is optional. No shell features (pipes, redirects, "&&", "$(...)") are supported. Only read-only subcommands are allowed — no staging, commits, checkout, reset, push, fetch, or config changes.',
    parameters: Type.Object({
      command: Type.String({
        description:
          'The read-only git command to run, as a single string, e.g. "diff --stat HEAD~1", "log -n 20 --oneline", "show abc123".',
      }),
      repo: Type.Optional(
        Type.String({
          description:
            "Working directory of the repository to inspect, relative to the current directory. Defaults to the current directory.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = params.repo ? path.resolve(ctx.cwd, params.repo) : ctx.cwd;
      const parsed = parseGitCommand(params.command);
      if (!parsed.ok) throw new Error(parsed.error);
      const { subcommand, args } = parsed;

      const violation = validateGitInvocation(subcommand, args);
      if (violation) throw new Error(`${violation} ${INTERFACE_HINT}`);

      const gitArgs = buildGitArguments(subcommand, args);
      const result = await runGit(cwd, gitArgs, signal, EXECUTION_TIMEOUT_MS);

      if (result.timedOut) {
        throw new Error(`git ${subcommand} was aborted after ${EXECUTION_TIMEOUT_MS / 1000}s.`);
      }
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim();
        throw new Error(
          detail
            ? `git ${subcommand} exited with status ${result.exitCode}: ${detail}`
            : `git ${subcommand} exited with status ${result.exitCode}.`,
        );
      }

      const stdoutTruncated = result.stdout.length > MAX_STDOUT_CHARACTERS;
      const stderrTruncated = result.stderr.length > MAX_STDERR_CHARACTERS;
      const parts = [result.stdout.trimEnd()];
      const warnings = result.stderr.trim();
      if (warnings) parts.push(warnings);
      let text = parts.filter(Boolean).join("\n");
      if (stdoutTruncated || stderrTruncated) text += "\n\n[output truncated]";
      if (!text) text = `(no output — git ${subcommand} produced nothing)`;

      return {
        content: [{ type: "text", text }],
        details: {
          subcommand,
          args,
          cwd,
          exitCode: result.exitCode,
          truncated: stdoutTruncated || stderrTruncated,
        },
      };
    },
  });
}