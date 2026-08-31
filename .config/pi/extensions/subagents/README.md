# Minimal Subagents

A pi extension that registers a single `subagent` tool with two agents:

| Agent | Tools | Model | Purpose |
|-------|-------|-------|---------|
| **scout** | read, find, ls, fd, rg, opensrc, git_read | openai-codex/gpt-5.6-luna:low | Local source, dependency internals, and git history research |
| **worker** | read, write, edit, safe_bash | openai-codex/gpt-5.5:low | Code changes |

## Usage

**Single mode:**
```json
{ "agent": "scout", "task": "Find all auth-related files in src/" }
```

**Parallel mode:**
```json
{ "tasks": [
  { "agent": "scout", "task": "Map the database layer" },
  { "agent": "scout", "task": "Find database-layer tests" }
]}
```

Max 4 concurrent subagents (configurable). Each runs as an isolated `pi` process with no inherited context — all context must be in the task description.

## Dependency source research

Scout uses the [`opensrc`](https://github.com/vercel-labs/opensrc) CLI to inspect upstream dependency source without scanning `node_modules` by default. The CLI must be available on `PATH` (`opensrc --version`).

- Explicit version or revision: scout marks the resolution as `explicit` and resolves that exact spec.
- Installed dependency: scout uses `project-lockfile` resolution and passes the project root.
- Uninstalled dependency: scout uses `latest` resolution and reports that choice.
- Tool results include the resolution mode, package metadata when available, and opensrc CLI version.
- opensrc writes to its own global cache, not the project.
- `node_modules` is a fallback for private, linked, patched, generated, or published-output-specific packages.

The custom `opensrc` tool exposes only source resolution; it does not grant scout general shell access or permission to modify files.

## Read-only git inspection

Scout's custom `git_read` tool answers questions about repository changes and history without any shell access. It takes a plain command string — `git_read { command: "diff --stat" }` — which is tokenized in-process and executed by spawning `git` directly with an argument array, never a shell. Only a fixed allowlist of read-only subcommands is accepted: `status`, `diff`, `log`, `show`, `blame`, `grep`, `ls-files`, `ls-tree`, `rev-parse`, `rev-list`, `describe`, `shortlog`, `merge-base`, `count-objects`, `for-each-ref`, `diff-tree`, `diff-index`, `diff-files`, `remote` (queries only), and `branch` (listing only).

- The interface is a single `command` string on purpose: the model previously failed when asked to split the command into a `subcommand` + `args` array (it passed whole command lines, sometimes duplicating the subcommand). A leading `git` prefix is tolerated; shell features (pipes, redirects, `&&`, substitution, backticks) are rejected with an explanatory error and are never interpreted.
- Mutating invocations are rejected before execution: `git branch <name>` (creation), `branch -d/-D/-m`, `remote add/set-url/...`, `--output=<file>`, and any non-allowlisted subcommand.
- Git runs with `GIT_OPTIONAL_LOCKS=0` (no index/ref locks), `GIT_TERMINAL_PROMPT=0`, and `GIT_PAGER=cat`; the diff-family subcommands additionally get `--no-ext-diff --no-textconv` prepended, so a configured external diff driver or textconv can never make git run an external program while inspecting a diff. Even the inspection itself is non-mutating.
- Output is capped at 16k chars with a truncation marker; the process is killed after 120s.
- `git_read` is only listed for the `scout` agent; the `worker` agent (which has `safe_bash`) cannot call it.

## Config

Optional `config.json` next to `index.ts`:

```json
{ "maxConcurrency": 4 }
```

## UI

Default view shows agent status, task preview, and the 20 most recent completed tools. Expand to inspect the bounded tool audit (up to 500 calls) with success/error status. Each retained event includes its call ID; aggregate call/error counts remain complete even when older audit entries are dropped.

## Registering Agents from Other Extensions

Other extensions can dynamically register and unregister agents at runtime. This is useful for domain-specific agents that should only be available when a particular extension is active.

### 1. Define agent `.md` files

Create markdown files with YAML frontmatter in your extension's directory (e.g. `my-extension/agents/my-agent.md`):

```markdown
---
name: my-agent
description: Does a specific thing
tools: web_fetch, video_extract
model: claude-sonnet-4-20250514
---

You are an agent that does a specific thing...
```

Frontmatter fields:
- **name** (required) — unique agent name, used in `{ agent: "my-agent" }` calls
- **description** — short description
- **tools** — comma-separated list of tools the agent needs (builtin or extension)
- **model** — model identifier with an optional `:<thinking>` suffix (defaults to `anthropic/claude-sonnet-4-6`)

The markdown body becomes the agent's system prompt.

### 2. Register agents via `globalThis.__pi_subagents`

Pi loads extensions via jiti, which creates separate module instances. Direct imports from the subagents extension will reference a different `agents` array than the one the `subagent` tool uses. Use the `globalThis` bridge instead:

```typescript
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

interface AgentConfig {
  name: string;
  description: string;
  tools: string[];
  model: string;
  systemPrompt: string;
  filePath: string;
}

const AGENTS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "agents");

function registerMyAgents(): void {
  const subagents = (globalThis as any).__pi_subagents as
    | { registerAgent: (config: AgentConfig) => void; unregisterAgent: (name: string) => void }
    | undefined;
  if (!subagents) return; // subagents extension not loaded

  for (const entry of fs.readdirSync(AGENTS_DIR)) {
    if (!entry.endsWith(".md")) continue;
    const filePath = path.join(AGENTS_DIR, entry);
    const content = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name) continue;

    const tools = (frontmatter.tools || "").split(",").map(t => t.trim()).filter(Boolean);
    try {
      subagents.registerAgent({
        name: frontmatter.name,
        description: frontmatter.description || "",
        tools,
        model: frontmatter.model || "anthropic/claude-sonnet-4-6",
        systemPrompt: body,
        filePath,
      });
    } catch {
      // Already registered — skip
    }
  }
}
```

Call `registerMyAgents()` when your extension activates (e.g. in a command handler). The agents become available to the `subagent` tool immediately.

### 3. Adding custom tool support

If your agents need tools beyond the built-in set, those tools must be mapped in the `CUSTOM_TOOL_EXTENSIONS` record in `subagents/index.ts`:

```typescript
const CUSTOM_TOOL_EXTENSIONS: Record<string, string> = {
  fd: path.join(EXT_BASE, "file-search", "index.ts"),
  rg: path.join(EXT_BASE, "file-search", "index.ts"),
  opensrc: path.join(TOOLS_DIR, "opensrc.ts"),
  web_fetch: path.join(EXT_BASE, "web-fetch", "index.ts"),
  safe_bash: path.join(TOOLS_DIR, "safe-bash.ts"),
  video_extract: path.join(EXT_BASE, "video-extract", "index.ts"),
  youtube_search: path.join(EXT_BASE, "youtube-search", "index.ts"),
  google_image_search: path.join(EXT_BASE, "google-image-search", "index.ts"),
};
```

Built-in tools (`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`) work automatically. Any other tool the agent lists in its frontmatter must have a corresponding entry here pointing to the extension's `index.ts`.

## Structure

```
subagents/
├── index.ts           # Extension entry point
├── agents/            # Built-in agent configs (frontmatter + system prompt)
└── tools/             # Extensions loaded into subagent processes
    ├── opensrc.ts     # scoped Effect wrapper for upstream source resolution
    └── safe-bash.ts   # bash with dangerous command blocking
```
