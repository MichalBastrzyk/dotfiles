Follow the rules below strictly

## Tools

- For frontend tasks, first load `/skill:agent-browser`.
- Use `/skill:agent-browser` to verify UI changes, flows, new components, and browser behavior.
- Check the browser console after frontend changes.
- Use browser tools to reduce manual testing by the user as much as possible.
- Keep tool usage focused. Do not load unnecessary skills.
- When you need information, preferences, or decisions from the user, use the `ask_user_question` tool instead of asking in plain text. It provides a structured interactive UI with selectable options.

## Code Style

- Less code is better.
- Prefer functional patterns when they fit naturally.
- Use classes only when they are the clearest design choice.
- Avoid unnecessary helpers, wrappers, abstractions, and backward-compatibility work unless clearly needed.
- Infer TypeScript types whenever possible.


## React

- In React projects, always import React as: `import * as React from "react"`.
- Avoid `useEffect` and `useLayoutEffect` as much as possible.
- Prefer splitting large pages into feature-oriented sections/components.
- Do not create huge route or page files.
- Reuse existing components before creating new ones.
- Avoid prop drilling. Prefer the existing state pattern, or use a store approach like Zustand/Jotai when passing state through many layers would be ugly.

## Packages

- Default to bun as the package manager and the script runner, but respect what an existing project uses even if it's not bun
- Never edit `package.json` manually to add dependencies
