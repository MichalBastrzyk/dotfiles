# Pi CodeRabbit extension (Effect v4)

A command-only Pi extension for CodeRabbit CLI reviews.

- Only the user can start a review with `/cr`.
- No LLM-callable CodeRabbit tool is registered.
- The extension owns the long-running `coderabbit review --agent` process.
- It parses CodeRabbit's JSONL stream with Effect Schema.
- It waits for both the JSONL `complete` event and process exit.
- Only after completion does it send findings to the coding agent.
- Direct model-issued `cr` / `coderabbit` Bash calls are blocked on a best-effort basis.

## Requirements

- Pi `@earendil-works/pi-coding-agent`
- Node.js 18 or newer
- CodeRabbit CLI installed and authenticated

```bash
brew install --cask coderabbit
coderabbit auth login
coderabbit doctor
```

## Install globally in Pi

```bash
mkdir -p ~/.pi/agent/extensions/pi-coderabbit
cp -R /path/to/pi-coderabbit-effect-v4/. ~/.pi/agent/extensions/pi-coderabbit/
cd ~/.pi/agent/extensions/pi-coderabbit
npm install --ignore-scripts
```

Inside Pi:

```text
/reload
```

For a quick test without copying it into the global extension directory:

```bash
cd /path/to/pi-coderabbit-effect-v4
npm install --ignore-scripts
pi -e ./index.ts
```

## Commands

```text
/cr
/cr uncommitted
/cr staged
/cr committed
/cr all
/cr base main
/cr uncommitted --dir packages/web
/cr uncommitted --light
/cr uncommitted --tracked-only
```

Default `/cr` behavior:

```bash
coderabbit review --agent --uncommitted --include-untracked
```

`/cr staged` reviews only the snapshot currently stored in Git's index. The extension creates a temporary commit object from the index, checks it out in a detached temporary worktree, and runs CodeRabbit with `--committed` there. The original repository's HEAD, branch, index, working tree, and untracked files are not changed. The temporary worktree is removed after success, failure, or cancellation. If nothing is staged, the review fails before CodeRabbit starts.

`--dir <path>` restricts the review to one folder, relative to the repository root. Run separate reviews for additional folders. `--tracked-only` prevents `--include-untracked` from being added; staged and committed reviews reject the flag because it has no meaning for those scopes. Otherwise, Pi asks you to confirm that you inspected untracked files for secrets before including them. `--light` requests CodeRabbit's lighter local review policy.

## Blocking review console

`/cr` waits for Pi to become fully idle, then opens a nearly full-screen review console. The command and console remain active until the review settles and you choose what to do with the result. The coding agent does not launch, monitor, or time out CodeRabbit.

While running, the console shows repository and scope, elapsed time, heartbeat age, current status, process and stdout state, parsed event and finding counts, progress milestones, and a live scrollable list containing every finding received.

Controls while running:

- `Ctrl+C` — cancel immediately
- `Escape` — show cancellation confirmation; it never cancels on the first press
- `Enter` — confirm cancellation while that confirmation is visible
- `Up`/`Down` or `j`/`k` — browse every finding received so far
- `PageUp`/`PageDown` — scroll findings by page
- `g`/`G` — jump to the first/latest finding; new findings follow automatically until you scroll away

The shared `desktop-notify` extension sends a desktop notification as soon as the review completes or fails. User cancellation does not notify.

After completion, the result stays open until you act:

- `Enter` — send findings to the coding agent
- `V` — toggle compact/full finding details
- `Q` — close without sending
- `Up`/`Down` or `j`/`k` — scroll
- `PageUp`/`PageDown` — scroll by page
- `g`/`G` — jump to top/bottom

## Runtime behavior

1. `/cr` waits until the current Pi agent turn, retries, compaction retries, and queued continuations are fully idle.
2. The extension locates the Git repository root. For a staged review, it creates and checks out an isolated temporary commit containing exactly the index snapshot.
3. It starts CodeRabbit with an argument array, not a shell command. `stdout` and `stderr` are drained concurrently while JSONL events update the blocking console.
4. Known events are validated and normalized: `review_context`, `status`, `heartbeat`, `finding`, `error`, and `complete`.
5. Heartbeats refresh liveness without flooding the activity log.
6. Unknown additive events are ignored safely; malformed lines are recorded without aborting the stream.
7. Completion requires both the JSONL `complete` event and process exit.
8. An `error` event, non-zero exit code, or missing `complete` event opens the failed-results screen.
9. Findings are sent as a new user turn only after completion and explicit `Enter` confirmation.
10. Cancellation interrupts the scoped Effect process, sends `SIGTERM`, escalates to `SIGKILL` after five seconds if necessary, waits for cleanup, and sends nothing to the agent.

There is intentionally no hard total timeout. CodeRabbit reviews may take a long time, and heartbeat events indicate that the process is still alive. Closing the console externally, Pi shutdown, or extension reload interrupts the scoped review process.

## Development

```bash
npm run typecheck
npm test
```

Effect v4 is pinned because it is currently a beta API and the process modules are under `effect/unstable/process`.

## Security note

The Bash interception guard prevents normal direct model calls such as `cr review --agent` and `coderabbit review`. It is not an OS sandbox and cannot stop deliberately obfuscated execution through generated scripts, variables, or another process. The hard architectural boundary is that the extension itself does not expose a CodeRabbit tool to the model; use Pi's sandboxing/container controls when adversarial command execution must be prevented.
