const ANSI_PREFIX = /^\x1b\[[0-9;?]*[a-zA-Z]/;

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");

export const visibleWidth = (text: string) => Array.from(stripAnsi(text)).length;

export const truncateToWidth = (text: string, width: number) => {
  if (width <= 0) return "";
  let out = "", used = 0, rest = text;
  while (rest.length) {
    if (rest[0] === "\x1b") {
      const match = ANSI_PREFIX.exec(rest);
      if (!match) break;
      out += match[0];
      rest = rest.slice(match[0].length);
      continue;
    }
    const char = String.fromCodePoint(rest.codePointAt(0)!);
    if (used + 1 > width) return out.includes("\x1b[") && !out.endsWith("\x1b[0m") ? `${out}\x1b[0m` : out;
    out += char;
    used++;
    rest = rest.slice(char.length);
  }
  return out;
};

export const pad = (text: string, width: number) => {
  const truncated = truncateToWidth(text, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
};
