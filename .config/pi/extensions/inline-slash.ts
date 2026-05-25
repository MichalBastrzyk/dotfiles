import fs from "node:fs";
import os from "node:os";
import type { ExtensionAPI, Skill } from "@mariozechner/pi-coding-agent";
import { loadSkills, stripFrontmatter } from "@mariozechner/pi-coding-agent";
import { Editor, fuzzyFilter } from "@mariozechner/pi-tui";

const INLINE_BOUNDARY_RE = /(^|[\s([{])\/[A-Za-z0-9:_-]*$/;
const SKILL_TOKEN_RE = /(^|[\s([{])\/skill:([A-Za-z0-9._-]+)/g;

function inlineSlashPrefix(text: string) {
  const match = INLINE_BOUNDARY_RE.exec(text);
  return match ? text.slice(match.index + match[1]!.length) : undefined;
}

function skillBlock(skill: Skill) {
  const body = stripFrontmatter(fs.readFileSync(skill.filePath, "utf-8")).trim();
  return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}

function loadSkillMap(cwd: string) {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? `${os.homedir()}/.config/pi`;
  const { skills } = loadSkills({ cwd, agentDir, skillPaths: [], includeDefaults: true });
  return new Map(skills.map((skill) => [skill.name, skill]));
}

function installInlineSlashEditorPatch() {
  const proto = Editor.prototype as any;
  if (proto.__inlineSlashPatchInstalled) return;
  proto.__inlineSlashPatchInstalled = true;

  const originalIsAtStartOfMessage = proto.isAtStartOfMessage;
  const originalIsInSlashCommandContext = proto.isInSlashCommandContext;
  const originalHandleTabCompletion = proto.handleTabCompletion;

  proto.isAtStartOfMessage = function () {
    const line = this.state?.lines?.[this.state.cursorLine] ?? "";
    const beforeCursor = line.slice(0, this.state?.cursorCol ?? 0);
    return inlineSlashPrefix(beforeCursor) !== undefined || originalIsAtStartOfMessage.call(this);
  };

  proto.isInSlashCommandContext = function (textBeforeCursor: string) {
    return inlineSlashPrefix(textBeforeCursor) !== undefined || originalIsInSlashCommandContext.call(this, textBeforeCursor);
  };

  proto.handleTabCompletion = function () {
    const line = this.state?.lines?.[this.state.cursorLine] ?? "";
    const beforeCursor = line.slice(0, this.state?.cursorCol ?? 0);
    if (inlineSlashPrefix(beforeCursor) !== undefined) {
      this.requestAutocomplete({ force: false, explicitTab: true });
      return;
    }
    originalHandleTabCompletion.call(this);
  };
}

export default function (pi: ExtensionAPI) {
  installInlineSlashEditorPatch();

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.addAutocompleteProvider((current) => ({
      async getSuggestions(lines, cursorLine, cursorCol, options) {
        const line = lines[cursorLine] ?? "";
        const beforeCursor = line.slice(0, cursorCol);
        const prefix = inlineSlashPrefix(beforeCursor);

        if (!prefix || beforeCursor.startsWith("/") || options.force) {
          return current.getSuggestions(lines, cursorLine, cursorCol, options);
        }

        const commands = ((current as any).commands ?? pi.getCommands()) as Array<{
          name?: string;
          value?: string;
          description?: string;
          argumentHint?: string;
        }>;
        const commandItems = commands
          .map((command) => {
            const name = command.name ?? command.value ?? "";
            return { value: name, label: name, description: command.description };
          })
          .filter((item) => item.value.startsWith("skill:"));

        const query = prefix.slice(1);
        const items = fuzzyFilter(commandItems, query, (item) => item.value);
        return items.length ? { items, prefix } : null;
      },

      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        if (prefix.startsWith("/") && cursorCol >= prefix.length) {
          const line = lines[cursorLine] ?? "";
          const beforePrefix = line.slice(0, cursorCol - prefix.length);
          const afterCursor = line.slice(cursorCol);
          const nextLine = `${beforePrefix}/${item.value} ${afterCursor}`;
          const nextLines = [...lines];
          nextLines[cursorLine] = nextLine;
          return {
            lines: nextLines,
            cursorLine,
            cursorCol: beforePrefix.length + item.value.length + 2,
          };
        }

        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      },

      shouldTriggerFileCompletion: current.shouldTriggerFileCompletion?.bind(current),
    }));
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };

    const skills = loadSkillMap(ctx.cwd);
    let changed = false;
    const text = event.text.replace(SKILL_TOKEN_RE, (whole, boundary: string, name: string) => {
      const skill = skills.get(name);
      if (!skill) return whole;
      changed = true;
      return `${boundary}${skillBlock(skill)}`;
    });

    return changed ? { action: "transform", text } : { action: "continue" };
  });
}
