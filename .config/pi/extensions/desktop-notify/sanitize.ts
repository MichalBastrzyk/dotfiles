const CONTROL_CHAR_RE = /[\p{Cc}\p{Cf}]/gu;

export function sanitizeNotificationText(
  input: string,
  fallback: string,
  maxLength: number,
) {
  const sanitized = input
    .replace(CONTROL_CHAR_RE, " ")
    .replaceAll(";", " ")
    .replace(/\s+/g, " ")
    .trim();
  const text = sanitized || fallback;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
