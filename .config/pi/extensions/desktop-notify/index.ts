import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DESKTOP_NOTIFICATION_CHANNEL,
  isDesktopNotificationRequest,
  type DesktopNotificationRequest,
} from "./channel.ts";
import { notifyTurnComplete } from "./notify.ts";

type Notify = (options?: DesktopNotificationRequest) => void;
type AskUserQuestionInput = {
  questions?: Array<{ question?: string; header?: string }>;
};

function questionBody(input: unknown) {
  const questions = (input as AskUserQuestionInput | undefined)?.questions ?? [];
  const firstQuestion = questions[0]?.question?.trim();
  const topics = questions
    .map((question) => question.header?.trim())
    .filter(Boolean)
    .join(", ");

  return firstQuestion || (topics ? `Question waiting: ${topics}` : "A question is waiting in Pi");
}

export function registerDesktopNotifications(
  pi: ExtensionAPI,
  notify: Notify = ({ title, body } = {}) => {
    notifyTurnComplete({
      env: {
        ...process.env,
        ...(title ? { PI_NOTIFY_DESKTOP_TITLE: title } : {}),
        ...(body ? { PI_NOTIFY_DESKTOP_BODY: body } : {}),
      },
    });
  },
) {
  let turnNotified = false;
  const questionToolCalls = new Set<string>();

  const stopNotificationRequests = pi.events.on(
    DESKTOP_NOTIFICATION_CHANNEL,
    (request) => {
      if (isDesktopNotificationRequest(request)) notify(request);
    },
  );

  pi.on("session_start", () => {
    questionToolCalls.clear();
  });

  pi.on("agent_start", () => {
    turnNotified = false;
  });

  pi.on("tool_call", (event) => {
    if (
      event.toolName !== "ask_user_question" ||
      questionToolCalls.has(event.toolCallId)
    ) {
      return;
    }

    questionToolCalls.add(event.toolCallId);
    notify({ title: "Pi needs input", body: questionBody(event.input) });
  });

  const notifyCompletion = () => {
    if (turnNotified) return;
    turnNotified = true;
    notify();
  };

  pi.on("message_end", (event) => {
    if (
      event.message.role === "assistant" &&
      event.message.stopReason !== "toolUse" &&
      event.message.stopReason !== "error" &&
      event.message.stopReason !== "aborted"
    ) {
      notifyCompletion();
    }
  });

  pi.on("agent_end", notifyCompletion);
  pi.on("session_shutdown", () => stopNotificationRequests());
}

export default registerDesktopNotifications;
