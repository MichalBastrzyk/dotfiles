import assert from "node:assert/strict";
import test from "node:test";
import { DESKTOP_NOTIFICATION_CHANNEL } from "./channel.ts";
import { registerDesktopNotifications } from "./index.ts";
import { notifyTurnComplete } from "./notify.ts";

function extensionHarness() {
  const handlers = new Map<string, Array<(event: never) => void>>();
  const eventHandlers = new Map<string, Array<(value: unknown) => void>>();
  const pi = {
    on(name: string, handler: (event: never) => void) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    events: {
      on(name: string, handler: (value: unknown) => void) {
        eventHandlers.set(name, [...(eventHandlers.get(name) ?? []), handler]);
        return () => {
          eventHandlers.set(
            name,
            (eventHandlers.get(name) ?? []).filter((candidate) => candidate !== handler),
          );
        };
      },
      emit(name: string, value: unknown) {
        for (const handler of eventHandlers.get(name) ?? []) handler(value);
      },
    },
  } as Parameters<typeof registerDesktopNotifications>[0];
  const emit = (name: string, event: unknown = {}) => {
    for (const handler of handlers.get(name) ?? []) handler(event as never);
  };
  return { pi, emit };
}

test("questions notify immediately and completed turns notify once", () => {
  const { pi, emit } = extensionHarness();
  const notifications: Array<{ title?: string; body?: string }> = [];
  registerDesktopNotifications(pi, (options = {}) =>
    notifications.push(options),
  );

  emit("session_start");
  emit("agent_start");
  const question = {
    toolName: "ask_user_question",
    toolCallId: "question-1",
    input: { questions: [{ header: "Choice", question: "Pick one" }] },
  };
  emit("tool_call", question);
  emit("tool_call", question);
  emit("message_end", {
    message: { role: "assistant", stopReason: "toolUse" },
  });
  emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
  emit("agent_end");

  assert.deepEqual(notifications, [
    { title: "Pi needs input", body: "Pick one" },
    {},
  ]);
});

test("extensions can request custom desktop notifications", () => {
  const { pi, emit } = extensionHarness();
  const notifications: Array<{ title?: string; body?: string }> = [];
  registerDesktopNotifications(pi, (options = {}) => notifications.push(options));

  pi.events.emit(DESKTOP_NOTIFICATION_CHANNEL, {
    title: "CodeRabbit review complete",
    body: "3 findings",
  });
  pi.events.emit(DESKTOP_NOTIFICATION_CHANNEL, { title: 42 });
  emit("session_shutdown");
  pi.events.emit(DESKTOP_NOTIFICATION_CHANNEL, {
    title: "stale listener",
  });

  assert.deepEqual(notifications, [
    { title: "CodeRabbit review complete", body: "3 findings" },
  ]);
});

test("notifier sanitizes OSC content", () => {
  let output = "";
  const result = notifyTurnComplete({
    env: {
      PI_NOTIFY_DESKTOP_PROTOCOL: "osc777",
      PI_NOTIFY_DESKTOP_TITLE: "Unsafe;title",
      PI_NOTIFY_DESKTOP_BODY: "Body\u001b;value",
    },
    stdout: { isTTY: true, write: (chunk) => (output = chunk) },
    writeDevTty: () => false,
  });

  assert.equal(result.notified, true);
  assert.equal(output, "\u001b]777;notify;Unsafe title;Body value\u001b\\");
});

test("notifier does not write OSC sequences to non-TTY stdout", () => {
  let output = "";
  const result = notifyTurnComplete({
    env: { PI_NOTIFY_DESKTOP_PROTOCOL: "osc777" },
    stdout: { write: (chunk) => (output = chunk) },
    writeDevTty: () => false,
  });

  assert.deepEqual(result, { notified: false, reason: "non-tty" });
  assert.equal(output, "");
});
