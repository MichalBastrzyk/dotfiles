export const DESKTOP_NOTIFICATION_CHANNEL = "desktop-notify:request";

export interface DesktopNotificationRequest {
  readonly title?: string;
  readonly body?: string;
}

export function isDesktopNotificationRequest(
  value: unknown,
): value is DesktopNotificationRequest {
  if (value === null || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    (request.title === undefined || typeof request.title === "string") &&
    (request.body === undefined || typeof request.body === "string")
  );
}
