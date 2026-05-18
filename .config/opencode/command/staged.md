---
description: "Group staged changes and draft a commit messages"
model: "openai/gpt-5.3-codex"
reasoningEffort: "low"
subtask: true
---

Your responses to me should be minimal and as a concise as possible.

1. Run `git diff --cached` to view all currently staged changes.
2. Analyze the specific line changes and group them into strict, self-contained **Atomic Commits**. Following open-source best practices (like those used in the Linux Kernel and Angular):
   - Each group must represent exactly _one_ logical change (e.g., do not mix backend schema updates, frontend UI wiring, and tooling configurations together).
   - Each group should be "bisect-friendly" (the change should be isolated enough that reverting it wouldn't break unrelated features).
3. For _each_ atomic group, draft a separate Conventional Commit message.
   - Use the format: `type(scope): subject`
   - Include a brief body explaining the _why_ and _what_ of that specific atomic change.
4. Group the atomic changes using commands `git add -p`, `git add` and create the commit.
5. Output the commit messages with listed files and why.
