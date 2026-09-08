export type SecretInputResult = { type: "submit"; value: string } | { type: "cancel" };

interface SecretInputTheme {
  fg?(color: "accent" | "dim", text: string): string;
}

type EditCommand = "submit" | "cancel" | "left" | "right" | "home" | "end" | "backspace" | "delete";
type DecodedInput = { command: EditCommand } | { insert: string[]; markerRemainder: string };

const commands: Record<EditCommand, string[]> = {
  submit: ["\r", "\n"], cancel: ["\x1b", "\x03"], backspace: ["\x7f", "\b"], delete: ["\x1b[3~"],
  left: ["\x1b[D", "\x1bOD"], right: ["\x1b[C", "\x1bOC"], home: ["\x1b[H", "\x1bOH", "\x01"], end: ["\x1b[F", "\x1bOF", "\x05"],
};
const pasteMarkers = ["\x1b[200~", "\x1b[201~"];

const decodeInput = (data: string, markerRemainder: string): DecodedInput => {
  const command = (Object.keys(commands) as EditCommand[]).find((name) => commands[name].includes(data));
  if (command) return { command };

  const combined = markerRemainder + data;
  const stripped = pasteMarkers.reduce((value, marker) => value.replaceAll(marker, ""), combined);
  const remainderLength = Math.max(0, ...pasteMarkers.flatMap((marker) =>
    Array.from({ length: marker.length - 1 }, (_, index) => index + 1).filter((length) => stripped.endsWith(marker.slice(0, length))),
  ));
  const complete = remainderLength ? stripped.slice(0, -remainderLength) : stripped;
  const removedMarker = stripped !== combined;
  const pasted = removedMarker ? complete : markerRemainder || complete.startsWith("\x1b") ? "" : complete;
  return {
    insert: Array.from(pasted).filter((point) => !/[\u0000-\u001f\u007f]/u.test(point)),
    markerRemainder: remainderLength ? stripped.slice(-remainderLength) : "",
  };
};

export class SecretInput {
  private value: string[] = [];
  private cursor = 0;
  private disposed = false;
  private markerRemainder = "";

  constructor(private readonly options: { onDone(result: SecretInputResult): void; requestRender(): void; theme?: SecretInputTheme; prompt?: string }) {}

  render(width: number): string[] {
    const prompt = this.options.prompt ?? "Secret: ";
    const mask = `${"•".repeat(this.cursor)}▏${"•".repeat(this.value.length - this.cursor)}`;
    const shown = `${prompt}${mask}`;
    const safe = Array.from(shown).slice(0, Math.max(0, width)).join("");
    return [this.options.theme?.fg?.("accent", safe) ?? safe];
  }

  handleInput(data: string) {
    if (this.disposed) return;
    const decoded = decodeInput(data, this.markerRemainder);
    if ("insert" in decoded) {
      this.markerRemainder = decoded.markerRemainder;
      this.insert(decoded.insert);
      this.options.requestRender();
      return;
    }

    const handlers: Record<EditCommand, () => void> = {
      submit: () => this.options.onDone({ type: "submit", value: this.value.join("") }),
      cancel: () => { this.clear(); this.options.onDone({ type: "cancel" }); },
      left: () => { this.cursor = Math.max(0, this.cursor - 1); },
      right: () => { this.cursor = Math.min(this.value.length, this.cursor + 1); },
      home: () => { this.cursor = 0; },
      end: () => { this.cursor = this.value.length; },
      backspace: () => { if (this.cursor) this.value.splice(--this.cursor, 1); },
      delete: () => { this.value.splice(this.cursor, 1); },
    };
    handlers[decoded.command]();
    if (decoded.command !== "submit" && decoded.command !== "cancel") this.options.requestRender();
  }

  isEmpty() { return this.value.length === 0; }

  invalidate() {}
  dispose() { this.clear(); this.disposed = true; }
  private insert(printable: string[]) { this.value.splice(this.cursor, 0, ...printable); this.cursor += printable.length; }
  private clear() { this.value.fill(""); this.value.length = 0; this.cursor = 0; this.markerRemainder = ""; }
}
