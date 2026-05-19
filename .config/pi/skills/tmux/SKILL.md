---
name: tmux
description: use this skill when managing local development background processes - dev servers, watchers, docker, vite/next/wrangler/storybook, test watch modes, or any long-running terminal command.
---

Use tmux for long-running local processes.

Do not manage long-running processes with raw background shell jobs unless the user explicitly asks for it:

```bash
command &
nohup command &
command > /tmp/app.log 2>&1 &
```

## Default workflow

For long running tasks, dev servers, watchers, Docker processes:

1. Create or reuse one named tmux session per project.
2. Put related processes in the same session.
3. Use clear window names.
4. Report only the session, windows, commands, ports, attach command, and stop command.

## Commands

Create a session with one process:

```bash
tmux new-session -d -s <project> -n <window> '<command>'
```

Add another related process:

```bash
tmux new-window -t <project> -n <window> '<command>'
```

Attach:

```bash
tmux attach -t <project>
```

List sessions/windows:

```bash
tmux ls
tmux list-windows -t <project>
```

Read recent output without flooding context:

```bash
tmux capture-pane -t <project>:<window> -p | tail -80
```

Stop one process/window:

```bash
tmux kill-window -t <project>:<window>
```

Stop all project processes:

```bash
tmux kill-session -t <project>
```
