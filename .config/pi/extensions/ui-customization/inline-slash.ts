import fs from "node:fs";
import type { ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";
import {
  getAgentDir,
  loadSkills,
  stripFrontmatter,
} from "@earendil-works/pi-coding-agent";
import { Editor, fuzzyFilter } from "@earendil-works/pi-tui";

const INLINE_SLASH_RE = /(^|[\t ])\/[A-Za-z0-9:_-]*$/;
const SKILL_TOKEN_RE = /(?:^|[\s([{])\/skill:([A-Za-z0-9._-]+)/g;

function inlineSlashPrefix(text: string) {
  const match = INLINE_SLASH_RE.exec(text);
  return match ? text.slice(match.index + match[1].length) : undefined;
}

function referencedSkillNames(text: string) {
  return [...text.matchAll(SKILL_TOKEN_RE)].map((match) => match[1]);
}

function skillBlock(skill: Skill) {
  try {
    const body = stripFrontmatter(
      fs.readFileSync(skill.filePath, "utf8"),
    ).trim();
    return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
  } catch {
    return undefined;
  }
}

type EditorInternals = {
  state: { lines: string[]; cursorLine: number; cursorCol: number };
  isAtStartOfMessage(): boolean;
  isInSlashCommandContext(textBeforeCursor: string): boolean;
  handleTabCompletion(): void;
  requestAutocomplete(options: { force: boolean; explicitTab: boolean }): void;
};

function installInlineSlashSupport() {
  const prototype = Editor.prototype as unknown as EditorInternals;
  const originalIsAtStart = prototype.isAtStartOfMessage;
  const originalIsInContext = prototype.isInSlashCommandContext;
  const originalTabCompletion = prototype.handleTabCompletion;

  function isAtStartOfMessage(this: EditorInternals) {
    const line = this.state.lines[this.state.cursorLine] ?? "";
    const beforeCursor = line.slice(0, this.state.cursorCol);
    return (
      Boolean(inlineSlashPrefix(beforeCursor)) || originalIsAtStart.call(this)
    );
  }

  function isInSlashCommandContext(
    this: EditorInternals,
    textBeforeCursor: string,
  ) {
    return (
      Boolean(inlineSlashPrefix(textBeforeCursor)) ||
      originalIsInContext.call(this, textBeforeCursor)
    );
  }

  function handleTabCompletion(this: EditorInternals) {
    const line = this.state.lines[this.state.cursorLine] ?? "";
    const beforeCursor = line.slice(0, this.state.cursorCol);
    if (inlineSlashPrefix(beforeCursor)) {
      this.requestAutocomplete({ force: false, explicitTab: true });
      return;
    }
    originalTabCompletion.call(this);
  }

  prototype.isAtStartOfMessage = isAtStartOfMessage;
  prototype.isInSlashCommandContext = isInSlashCommandContext;
  prototype.handleTabCompletion = handleTabCompletion;

  return () => {
    if (prototype.isAtStartOfMessage === isAtStartOfMessage) {
      prototype.isAtStartOfMessage = originalIsAtStart;
    }
    if (prototype.isInSlashCommandContext === isInSlashCommandContext) {
      prototype.isInSlashCommandContext = originalIsInContext;
    }
    if (prototype.handleTabCompletion === handleTabCompletion) {
      prototype.handleTabCompletion = originalTabCompletion;
    }
  };
}

export default function (pi: ExtensionAPI) {
  let availableSkills: Skill[] = [];
  let removeEditorSupport: (() => void) | undefined;

  pi.on("session_start", (_event, ctx) => {
    availableSkills = loadSkills({
      cwd: ctx.cwd,
      agentDir: getAgentDir(),
      skillPaths: [],
      includeDefaults: true,
    }).skills;
    if (!ctx.hasUI) return;

    removeEditorSupport?.();
    removeEditorSupport = installInlineSlashSupport();
    ctx.ui.addAutocompleteProvider((current) => ({
      async getSuggestions(lines, cursorLine, cursorCol, options) {
        const line = lines[cursorLine] ?? "";
        const beforeCursor = line.slice(0, cursorCol);
        const prefix = inlineSlashPrefix(beforeCursor);

        if (!prefix || (cursorLine === 0 && beforeCursor === prefix)) {
          return current.getSuggestions(lines, cursorLine, cursorCol, options);
        }

        const items = availableSkills.map((skill) => ({
          value: `skill:${skill.name}`,
          label: `skill:${skill.name}`,
          description: skill.description,
        }));
        const matches = fuzzyFilter(
          items,
          prefix.slice(1),
          (item) => item.value,
        );
        return matches.length ? { items: matches, prefix } : null;
      },

      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        if (!prefix.startsWith("/") || cursorCol < prefix.length) {
          return current.applyCompletion(
            lines,
            cursorLine,
            cursorCol,
            item,
            prefix,
          );
        }

        const line = lines[cursorLine] ?? "";
        const beforePrefix = line.slice(0, cursorCol - prefix.length);
        const nextLines = [...lines];
        nextLines[cursorLine] =
          `${beforePrefix}/${item.value} ${line.slice(cursorCol)}`;
        return {
          lines: nextLines,
          cursorLine,
          cursorCol: beforePrefix.length + item.value.length + 2,
        };
      },

      shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
        const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
        if (inlineSlashPrefix(beforeCursor)) return true;
        return (
          current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ??
          true
        );
      },
    }));
  });

  pi.on("session_shutdown", () => {
    removeEditorSupport?.();
    removeEditorSupport = undefined;
  });

  pi.on("before_agent_start", (event) => {
    const names = [...new Set(referencedSkillNames(event.prompt))];
    if (!names.length) return;

    const skills = new Map(
      (event.systemPromptOptions.skills ?? []).map((skill) => [
        skill.name,
        skill,
      ]),
    );
    const blocks = names.flatMap((name) => {
      const skill = skills.get(name);
      if (!skill) return [];
      const block = skillBlock(skill);
      return block ? [block] : [];
    });
    if (!blocks.length) return;

    return {
      message: {
        customType: "inline-skills",
        content: blocks.join("\n\n"),
        display: false,
      },
    };
  });
}
