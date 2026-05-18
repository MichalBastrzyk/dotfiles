import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { notifyTurnComplete } from "/Users/me/dotfiles/.local/share/fnm/node-versions/v25.4.0/installation/lib/node_modules/@rbright/pi-notify-desktop/src/notify.ts";

type AskUserQuestionInput = {
  questions?: Array<{ question?: string; header?: string }>;
};

function notificationBody(input: unknown) {
  const questions = (input as AskUserQuestionInput | undefined)?.questions ?? [];
  const firstQuestion = questions[0]?.question?.trim();
  const topic = questions
    .map((q) => q.header?.trim())
    .filter(Boolean)
    .join(", ");

  if (firstQuestion) return firstQuestion;
  if (topic) return `Question waiting: ${topic}`;
  return "A question is waiting in pi";
}

export default function (pi: ExtensionAPI) {
  const notifiedToolCalls = new Set<string>();

  pi.on("session_start", () => {
    notifiedToolCalls.clear();
  });

  pi.on("tool_call", (event) => {
    if (event.toolName !== "ask_user_question") return;
    if (notifiedToolCalls.has(event.toolCallId)) return;

    notifiedToolCalls.add(event.toolCallId);
    notifyTurnComplete({
      env: {
        ...process.env,
        PI_NOTIFY_DESKTOP_TITLE: "Pi needs input",
        PI_NOTIFY_DESKTOP_BODY: notificationBody(event.input),
      },
    });
  });
}
