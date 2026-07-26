import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createReadTool, getLanguageFromPath, highlightCode } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { homedir } from "node:os";

const baseRead = createReadTool(process.cwd());

const shortenPath = (path: string) => {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
};

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "read",
    label: "read",
    description: baseRead.description,
    parameters: baseRead.parameters,
    prepareArguments: baseRead.prepareArguments,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return createReadTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      const path = typeof args.path === "string" ? shortenPath(args.path) : "...";
      const start = args.offset ?? 1;
      const end = args.limit ? start + args.limit - 1 : undefined;
      const range = args.offset !== undefined || args.limit !== undefined ? theme.fg("warning", `:${start}${end ? `-${end}` : ""}`) : "";

      return new Text(`${theme.fg("toolTitle", theme.bold("read"))} ${theme.fg("accent", path)}${range}`, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("dim", "reading…"), 0, 0);
      if (!expanded) return new Text("", 0, 0);

      const content = result.content.find((entry) => entry.type === "text" || entry.type === "image");
      if (!content) return new Text("", 0, 0);
      if (content.type === "image") return new Text(theme.fg("muted", "image"), 0, 0);

      const path = typeof context.args?.path === "string" ? context.args.path : "";
      const language = getLanguageFromPath(path);
      const text = language ? highlightCode(content.text, language, theme) : theme.fg("toolOutput", content.text);

      return new Text(text, 0, 0);
    },
  });
}
