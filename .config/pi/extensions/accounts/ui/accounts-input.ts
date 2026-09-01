/** Structural subset of Pi's KeybindingsManager with safe raw-key defaults. */
export interface AccountsKeybindings {
  matches(data: string, binding: string): boolean;
  getKeys(binding: string): readonly string[];
}

const DEFAULT_KEYS: Record<string, readonly string[]> = {
  "tui.select.cancel": ["\x1b", "\x03"],
  "tui.select.confirm": ["\r", "\n"],
  "tui.select.up": ["\x1b[A", "\x1bOA"],
  "tui.select.down": ["\x1b[B", "\x1bOB"],
  "tui.editor.pageUp": ["\x1b[5~"],
  "tui.editor.pageDown": ["\x1b[6~"],
};

export const defaultKeybindings = (): AccountsKeybindings => ({
  matches: (data, binding) => DEFAULT_KEYS[binding]?.includes(data) ?? false,
  getKeys: (binding) => DEFAULT_KEYS[binding] ?? [],
});

export type AccountsCommand = "cancelBusy" | "close" | "confirm" | "up" | "down" | "pageUp" | "pageDown" | "first" | "last" | "add" | "refresh" | "remove";

type BindingRule = { command: AccountsCommand; binding?: string; keys: readonly string[] };

// Order is significant when a custom keybinding matches more than one command.
const BINDING_RULES: readonly BindingRule[] = [
  { command: "close", binding: "tui.select.cancel", keys: ["\x1b", "\x03"] },
  { command: "confirm", binding: "tui.select.confirm", keys: ["\r", "\n"] },
  { command: "up", binding: "tui.select.up", keys: ["\x1b[A", "\x1bOA", "k"] },
  { command: "down", binding: "tui.select.down", keys: ["\x1b[B", "\x1bOB", "j"] },
  { command: "pageUp", binding: "tui.editor.pageUp", keys: ["\x1b[5~"] },
  { command: "pageDown", binding: "tui.editor.pageDown", keys: ["\x1b[6~"] },
  { command: "first", keys: ["\x1b[H", "\x1b[1~", "\x1b[7~", "g"] },
  { command: "last", keys: ["\x1b[F", "\x1b[4~", "\x1b[8~", "G"] },
  { command: "add", keys: ["a"] },
  { command: "refresh", keys: ["r"] },
  { command: "remove", keys: ["d"] },
];

const RAW_COMMANDS = new Map(BINDING_RULES.flatMap(({ command, keys }) => keys.map((key) => [key, command] as const)));
const BUSY_CANCEL_KEYS = new Set(["\x1b", "\x03", "c", "\r", "\n"]);

export const decodeAccountsInput = (data: string, keybindings: AccountsKeybindings, busy: boolean, busyCancellable: boolean): AccountsCommand | undefined => {
  if (busy) return busyCancellable && BUSY_CANCEL_KEYS.has(data) ? "cancelBusy" : undefined;
  const rawCommand = RAW_COMMANDS.get(data);
  return BINDING_RULES.find(({ command, binding }) => command === rawCommand || Boolean(binding && keybindings.matches(data, binding)))?.command;
};

const KEY_LABELS = new Map([
  ["\x1b", "esc"], ["\x03", "ctrl+c"], ["\r", "enter"], ["\n", "enter"],
  ["\x1b[A", "↑"], ["\x1bOA", "↑"], ["\x1b[B", "↓"], ["\x1bOB", "↓"],
  ["\x1b[5~", "pgup"], ["\x1b[6~", "pgdn"],
]);

export const keyHint = (keybindings: AccountsKeybindings, binding: string, fallback: string) => {
  const bound = keybindings.getKeys(binding)[0];
  if (!bound) return fallback;
  return KEY_LABELS.get(bound) ?? (/\p{C}/u.test(bound) ? fallback : bound);
};
