import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type Message = { role?: string; content?: unknown };
type Entry = { type?: string; message?: Message };

function textFromContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      if (!("type" in block)) return "";
      if (block.type === "image") return "[image]";
      if (block.type !== "text") return "";
      return "text" in block && typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function messages(entries: Entry[]) {
  return entries
    .filter((entry) => entry.type === "message")
    .map((entry) => entry.message)
    .filter(
      (message): message is Message => message?.role === "user" || message?.role === "assistant",
    );
}

function copyToClipboard(value: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("pbcopy");
    let stderr = "";

    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `pbcopy exited with code ${code}`)),
    );
    child.stdin.end(value);
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("copy-all", {
    description: "Copy all user and assistant messages in this thread to the clipboard",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      const thread = messages(ctx.sessionManager.getBranch());
      const text = thread
        .map((message) => {
          const content = textFromContent(message.content).trim();
          return content ? `${message.role?.toUpperCase()}:\n${content}` : "";
        })
        .filter(Boolean)
        .join("\n\n---\n\n");

      if (!text) return ctx.ui.notify("No user or assistant messages to copy", "info");
      await copyToClipboard(text);
      ctx.ui.notify(`Copied ${thread.length} messages to clipboard`, "info");
    },
  });
}
