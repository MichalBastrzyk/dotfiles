import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ThemeColor,
} from "@mariozechner/pi-coding-agent";

type Rgb = readonly [number, number, number];

const RESET = "\x1b[0m";
const TRUECOLOR_PREFIX = "\x1b[38;2;";
const TITLE_WIDTH = 16;
const RENDER_WIDTH = 120;

const TITLE_LINES = [
  "  ██████╗  ██╗ ",
  "  ██╔══██╗ ██║ ",
  "  ██████╔╝ ██║ ",
  "  ██╔═══╝  ██║ ",
  "  ██║      ██║ ",
  "  ╚═╝      ╚═╝ ",
] as const;

const THEME_COLORS = [
  "accent",
  "borderAccent",
  "mdHeading",
  "mdLink",
  "success",
  "text",
  "accent",
] as const satisfies readonly ThemeColor[];

const FALLBACK_PALETTE: readonly Rgb[] = [
  [22, 83, 189],
  [48, 129, 247],
  [93, 171, 255],
  [151, 205, 255],
  [93, 171, 255],
  [48, 129, 247],
];

const TRUECOLOR_RE = /38;2;(\d+);(\d+);(\d+)/;
const INDEXED_RE = /38;5;(\d+)/;

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function tint([r, g, b]: Rgb, amount: number): Rgb {
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return [lerp(r, target, t), lerp(g, target, t), lerp(b, target, t)];
}

function ansi256ToRgb(code: number): Rgb | undefined {
  if (code < 16 || code > 255) return undefined;
  if (code >= 232) {
    const gray = 8 + (code - 232) * 10;
    return [gray, gray, gray];
  }

  const c = code - 16;
  const level = (n: number) => (n === 0 ? 0 : 55 + n * 40);
  return [
    level(Math.floor(c / 36)),
    level(Math.floor((c % 36) / 6)),
    level(c % 6),
  ];
}

function themeRgb(theme: Theme, color: ThemeColor): Rgb | undefined {
  const ansi = theme.getFgAnsi(color);
  const trueColor = TRUECOLOR_RE.exec(ansi);
  if (trueColor) {
    return [+trueColor[1]!, +trueColor[2]!, +trueColor[3]!];
  }

  const indexed = INDEXED_RE.exec(ansi);
  return indexed ? ansi256ToRgb(+indexed[1]!) : undefined;
}

function buildPalette(theme: Theme): readonly Rgb[] {
  const base = THEME_COLORS.map((color) => themeRgb(theme, color)).filter(
    (color): color is Rgb => color !== undefined,
  );
  const colors = base.length >= 2 ? base : FALLBACK_PALETTE;
  const palette: Rgb[] = [];

  for (let i = 0; i < colors.length; i++) {
    const color = colors[i]!;
    const next = colors[(i + 1) % colors.length]!;
    palette.push(
      tint(color, i % 2 === 0 ? 0.12 : -0.08),
      mix(color, next, 0.35),
      mix(color, next, 0.7),
    );
  }

  return palette;
}

function sample(position: number, palette: readonly Rgb[]): Rgb {
  const scaled = (((position % 1) + 1) % 1) * palette.length;
  const index = scaled | 0;
  return mix(
    palette[index]!,
    palette[(index + 1) % palette.length]!,
    scaled - index,
  );
}

function color([r, g, b]: Rgb, text: string) {
  return `${TRUECOLOR_PREFIX}${r};${g};${b}m${text}${RESET}`;
}

function gradient(text: string, phase: number, palette: readonly Rgb[]) {
  const chars = [...text];
  const span = Math.max(chars.length - 1, 1);
  let output = "";

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    output += char === " " ? char : color(sample(i / span + phase, palette), char);
  }

  return output;
}

function center(text: string, width: number) {
  if (text.length >= width) return text;
  return `${" ".repeat((width - text.length) >> 1)}${text}`;
}

function projectName() {
  return path.basename(process.cwd()) || "session";
}

function createHeader(theme: Theme, getSubtitle: () => string) {
  let palette = buildPalette(theme);
  let cachedWidth = -1;
  let cachedSubtitle = "";
  let cachedLines: string[] = [];

  function rebuild(width: number) {
    const subtitle = getSubtitle();
    if (width === cachedWidth && subtitle === cachedSubtitle) return cachedLines;

    cachedWidth = width;
    cachedSubtitle = subtitle;
    cachedLines = [
      "",
      ...TITLE_LINES.map((line, row) =>
        gradient(center(line, width), row * 0.045, palette),
      ),
      theme.bold(gradient(center(subtitle, width), 0.18, palette)),
      "",
    ];
    return cachedLines;
  }

  return {
    render(width: number) {
      return rebuild(Math.max(width, TITLE_WIDTH));
    },
    invalidate() {
      palette = buildPalette(theme);
      cachedWidth = -1;
    },
  };
}

export default function (pi: ExtensionAPI) {
  let requestRender: (() => void) | undefined;
  let currentModelId = "no model selected";
  const cwdName = projectName();
  const nodeVersion = process.version;
  const subtitle = () => `${cwdName} · ${currentModelId} · Node ${nodeVersion}`;

  function installHeader(ctx: ExtensionContext) {
    ctx.ui.setHeader((tui, theme) => {
      requestRender = () => tui.requestRender();
      const header = createHeader(theme, subtitle);
      return {
        render: (width: number) => header.render(width),
        invalidate() {
          header.invalidate();
          tui.requestRender();
        },
      };
    });
  }

  pi.on("session_start", (_event, ctx) => {
    currentModelId = ctx.model?.id ?? "no model selected";
    if (ctx.hasUI) installHeader(ctx);
  });

  pi.on("model_select", (event) => {
    currentModelId = event.model.id;
    requestRender?.();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setHeader(undefined);
  });

  pi.registerCommand("flow-title", {
    description: "Enable the theme-derived flowing gradient session header",
    handler: async (_args, ctx) => {
      installHeader(ctx);
      ctx.ui.notify("Flow title enabled", "info");
    },
  });

  pi.registerCommand("flow-title-builtin", {
    description: "Restore pi's built-in header for this session",
    handler: async (_args, ctx) => {
      ctx.ui.setHeader(undefined);
      ctx.ui.notify("Built-in header restored", "info");
    },
  });
}
