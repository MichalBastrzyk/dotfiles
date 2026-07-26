import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { DESKTOP_NOTIFICATION_CHANNEL } from "../desktop-notify/channel.ts";
import { InvalidReviewArguments, parseReviewRequest } from "./src/args.ts";
import { looksLikeCodeRabbitInvocation } from "./src/guard.ts";
import { renderAgentHandoff, renderExecutionError } from "./src/render.ts";
import { reviewDesktopNotification } from "./src/review-notification.ts";
import { CodeRabbitReviewScreen, type ReviewConsoleResult } from "./src/review-screen.ts";
import { CodeRabbitReviewSession } from "./src/review-session.ts";

export default function coderabbitExtension(pi: ExtensionAPI): void {
  let reviewRunning = false;

  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;

    if (looksLikeCodeRabbitInvocation(event.input.command)) {
      return {
        block: true,
        reason:
          "CodeRabbit is user-controlled. The agent cannot invoke `cr` or `coderabbit`; ask the user to run `/cr` manually.",
      };
    }
  });

  pi.registerCommand("cr", {
    description: "Run CodeRabbit and hand completed findings to the agent",
    handler: async (args, ctx) => {
      if (reviewRunning) {
        ctx.ui.notify("A CodeRabbit review is already running.", "warning");
        return;
      }

      if (ctx.mode !== "tui") {
        ctx.ui.notify("The CodeRabbit review console requires interactive TUI mode.", "error");
        return;
      }

      reviewRunning = true;

      try {
        let request;
        try {
          request = parseReviewRequest(args);
        } catch (error) {
          const message =
            error instanceof InvalidReviewArguments
              ? error.message
              : error instanceof Error
                ? error.message
                : String(error);
          ctx.ui.notify(message, "error");
          return;
        }

        if ("includeUntracked" in request.scope && request.scope.includeUntracked) {
          const approved = await ctx.ui.confirm(
            "Include untracked files?",
            "Untracked file contents will be sent to CodeRabbit. Confirm that you inspected them for secrets and want to include them.",
          );
          if (!approved) {
            ctx.ui.notify("CodeRabbit review cancelled.", "info");
            return;
          }
        }

        await ctx.waitForIdle();

        const consoleResult = await ctx.ui.custom<ReviewConsoleResult>(
          (tui, theme, keybindings, done) => {
            const session = new CodeRabbitReviewSession(request, ctx.cwd);
            const stopNotifications = session.subscribe(() => {
              const state = session.getState();
              const notification = reviewDesktopNotification(state);
              if (notification !== undefined) {
                stopNotifications();
                pi.events.emit(DESKTOP_NOTIFICATION_CHANNEL, notification);
              } else if (state._tag === "Cancelled") {
                stopNotifications();
              }
            });
            const screen = new CodeRabbitReviewScreen(tui, theme, keybindings, session, done);
            session.start();
            return screen;
          },
          {
            overlay: true,
            overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
          },
        );

        if (consoleResult.action === "cancelled") {
          ctx.ui.notify("CodeRabbit review cancelled.", "info");
          return;
        }
        if (consoleResult.action === "dismiss") return;

        const result = consoleResult.result;
        if (result.complete.status === "review_skipped") {
          ctx.ui.notify(result.complete.message ?? "CodeRabbit skipped the review.", "info");
          return;
        }
        if (result.findings.length === 0) {
          const diagnostics =
            result.malformedLines.length > 0
              ? ` (${result.malformedLines.length} malformed JSONL line(s) ignored)`
              : "";
          ctx.ui.notify(`CodeRabbit completed with no findings${diagnostics}.`, "info");
          return;
        }

        // The console remains open until the user explicitly confirms this handoff.
        pi.sendUserMessage(renderAgentHandoff(result));
      } catch (error) {
        ctx.ui.notify(renderExecutionError(error), "error");
      } finally {
        reviewRunning = false;
      }
    },
  });
}
