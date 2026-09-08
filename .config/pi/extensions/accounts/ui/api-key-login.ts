import { spawn } from "node:child_process";
import { PROVIDERS, type CatalogProviderId } from "../providers/catalog.ts";
import { SecretInput } from "./secret-input.ts";
import { truncateToWidth, visibleWidth } from "./terminal-text.ts";

export interface ApiKeyLoginTheme {
  fg?(
    color: "accent" | "border" | "text" | "muted" | "dim" | "success" | "warning" | "error",
    text: string,
  ): string;
  bold?(text: string): string;
}

export interface ApiKeyLoginConfig {
  title: string;
  intro: readonly string[];
  required?: string;
  dashboardUrl: string;
  dashboardLabel: string;
  prompt: string;
}

export const apiKeyLoginConfigFor = (provider: CatalogProviderId): ApiKeyLoginConfig => {
  const entry = PROVIDERS[provider];
  if (provider === "cheaper-inference") {
    return {
      title: "CheaperInference",
      intro: ["Create a dedicated API key for Pi."],
      required: "Required: inference + usage:read + account:read",
      dashboardUrl: entry.dashboardUrl ?? "https://api.cheaperinference.com/dashboard/keys",
      dashboardLabel: "Open API Keys",
      prompt: entry.keyPrompt ?? "API key: ",
    };
  }
  return {
    title: entry.name,
    intro: [`Add an ${entry.name} API key for Pi.`],
    required: entry.requiredScopes ? `Required: ${entry.requiredScopes}` : undefined,
    dashboardUrl: entry.dashboardUrl ?? "https://opencode.ai/dashboard",
    dashboardLabel: "Open dashboard",
    prompt: entry.keyPrompt ?? "API key: ",
  };
};

export const openDashboardUrl = (url: string): void => {
  try {
    const opener =
      process.platform === "darwin"
        ? { command: "open", args: [url] }
        : process.platform === "win32"
          ? { command: "cmd", args: ["/c", "start", "", url] }
          : { command: "xdg-open", args: [url] };
    const child = spawn(opener.command, opener.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // Opening a browser is best-effort; the URL is still shown in the dialog.
  }
};

interface ApiKeyLoginDialogOptions {
  config: ApiKeyLoginConfig;
  theme?: ApiKeyLoginTheme;
  requestRender(): void;
  onDone(value?: string): void;
  openUrl?: (url: string) => void;
}

export class ApiKeyLoginDialog {
  private readonly secret: SecretInput;
  private disposed = false;

  constructor(private readonly options: ApiKeyLoginDialogOptions) {
    this.secret = new SecretInput({
      prompt: options.config.prompt,
      theme: options.theme,
      requestRender: options.requestRender,
      onDone: (result) => {
        if (result.type === "submit") this.options.onDone(result.value);
        else this.options.onDone(undefined);
      },
    });
  }

  handleInput(data: string) {
    if (this.disposed) return;
    if ((data === "o" || data === "O") && this.secret.isEmpty()) {
      (this.options.openUrl ?? openDashboardUrl)(this.options.config.dashboardUrl);
      this.options.requestRender();
      return;
    }
    this.secret.handleInput(data);
  }

  render(width: number): string[] {
    const { config, theme } = this.options;
    const fg = (color: Parameters<NonNullable<ApiKeyLoginTheme["fg"]>>[0], text: string) =>
      theme?.fg?.(color, text) ?? text;
    const lines: string[] = [];
    lines.push(fg("accent", theme?.bold?.(config.title) ?? config.title));
    lines.push("");
    for (const line of config.intro) lines.push(fg("text", line));
    if (config.required) {
      lines.push("");
      lines.push(fg("muted", config.required));
    }
    lines.push("");
    lines.push(fg("muted", `[o] ${config.dashboardLabel}`));
    lines.push(fg("dim", truncateToWidth(config.dashboardUrl, Math.max(0, width))));
    lines.push("");
    for (const line of this.secret.render(Math.max(0, width))) lines.push(line);
    lines.push("");
    lines.push(fg("dim", "Enter save · Esc cancel"));
    return lines.map((line) => {
      if (visibleWidth(line) <= width) return line;
      return truncateToWidth(line, width);
    });
  }

  invalidate() {
    this.secret.invalidate();
  }

  dispose() {
    this.disposed = true;
    this.secret.dispose();
  }
}

export const promptApiKey = async (
  ctx: any,
  provider: CatalogProviderId,
  openUrl: (url: string) => void = openDashboardUrl,
): Promise<string | undefined> => {
  const config = apiKeyLoginConfigFor(provider);
  return ctx.ui.custom(
    (tui: any, theme: any, _kb: any, done: (value?: string) => void) =>
      new ApiKeyLoginDialog({
        config,
        theme,
        requestRender: () => tui.requestRender(),
        onDone: done,
        openUrl,
      }),
  );
};
