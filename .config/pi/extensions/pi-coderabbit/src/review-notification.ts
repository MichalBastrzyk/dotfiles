import type { DesktopNotificationRequest } from "../../desktop-notify/channel.ts";
import type { ReviewState } from "./review-session.ts";

export function reviewDesktopNotification(
  state: ReviewState,
): DesktopNotificationRequest | undefined {
  if (state._tag === "Completed") {
    const count = state.result.findings.length;
    const skipped = state.result.complete.status === "review_skipped";
    return {
      title: skipped ? "CodeRabbit review skipped" : "CodeRabbit review complete",
      body: skipped
        ? `${state.result.repositoryRoot}: ${state.result.complete.message ?? "No review was needed."}`
        : `${count} finding${count === 1 ? "" : "s"} in ${state.result.repositoryRoot}`,
    };
  }

  if (state._tag === "Failed") {
    return {
      title: "CodeRabbit review failed",
      body: `${state.repositoryRoot ?? state.cwd}: ${state.message}`,
    };
  }

  return undefined;
}
