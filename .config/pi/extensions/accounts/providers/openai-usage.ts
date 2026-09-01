import { Schema } from "effect";
import type { UsageWindow } from "../domain.ts";

const nullable = <S extends Schema.Top>(schema: S) => Schema.NullOr(schema);

const Window = Schema.Struct({
  used_percent: Schema.Number,
  limit_window_seconds: Schema.optional(nullable(Schema.Number)),
  reset_at: Schema.optional(nullable(Schema.Number)),
  reset_after_seconds: Schema.optional(nullable(Schema.Number)),
});

const Additional = Schema.Struct({
  name: Schema.optional(nullable(Schema.String)),
  limit_name: Schema.optional(nullable(Schema.String)),
  rate_limit: Schema.optional(nullable(Window)),
  window: Schema.optional(nullable(Window)),
  used_percent: Schema.optional(nullable(Schema.Number)),
  limit_window_seconds: Schema.optional(nullable(Schema.Number)),
  reset_at: Schema.optional(nullable(Schema.Number)),
  reset_after_seconds: Schema.optional(nullable(Schema.Number)),
});

export const OpenAIUsagePayload = Schema.Struct({
  plan_type: Schema.optional(nullable(Schema.String)),
  plan: Schema.optional(nullable(Schema.String)),
  rate_limit: Schema.optional(
    nullable(
      Schema.Struct({
        primary_window: Schema.optional(nullable(Window)),
        secondary_window: Schema.optional(nullable(Window)),
      }),
    ),
  ),
  primary_window: Schema.optional(nullable(Window)),
  secondary_window: Schema.optional(nullable(Window)),
  additional_rate_limits: Schema.optional(nullable(Schema.Array(Additional))),
});

const clamp = (n: number) => Math.max(0, Math.min(100, n));

const label = (seconds?: number) => {
  if (seconds === 18_000) return "5h";
  if (seconds === 604_800) return "weekly";
  if (seconds) return `${seconds}s`;
  return "additional";
};

const normalizeWindow = (value: typeof Window.Type, now: number): UsageWindow => ({
  used: clamp(value.used_percent),
  limit: 100,
  resetsAt: value.reset_at
    ? value.reset_at * 1000
    : value.reset_after_seconds
      ? now + value.reset_after_seconds * 1000
      : undefined,
});

const allocateWindowId = (used: ReadonlySet<string>, requested: string, kind: string) => {
  if (!used.has(requested)) return requested;

  const qualified = `${requested}-${kind}`;
  if (!used.has(qualified)) return qualified;

  for (let suffix = 2; ; suffix++) {
    const candidate = `${qualified}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
};

type CollectedWindow = {
  requested: string;
  kind: string;
  window: typeof Window.Type;
};

const firstDefinedWindow = (
  nested: typeof Window.Type | null | undefined,
  topLevel: typeof Window.Type | null | undefined,
) => nested ?? topLevel ?? undefined;

const collectedWindow = (
  window: typeof Window.Type | undefined,
  kind: "primary" | "secondary",
): CollectedWindow[] => window
  ? [{ requested: label(window.limit_window_seconds ?? undefined), kind, window }]
  : [];

const collectPrimaryWindows = (data: typeof OpenAIUsagePayload.Type): CollectedWindow[] => [
  ...collectedWindow(firstDefinedWindow(data.rate_limit?.primary_window, data.primary_window), "primary"),
  ...collectedWindow(firstDefinedWindow(data.rate_limit?.secondary_window, data.secondary_window), "secondary"),
];

const additionalWindow = (extra: typeof Additional.Type): typeof Window.Type | undefined => {
  if (extra.rate_limit) return extra.rate_limit;
  if (extra.window) return extra.window;
  if (extra.used_percent === undefined || extra.used_percent === null) return undefined;

  return {
    used_percent: extra.used_percent,
    limit_window_seconds: extra.limit_window_seconds ?? undefined,
    reset_at: extra.reset_at ?? undefined,
    reset_after_seconds: extra.reset_after_seconds ?? undefined,
  };
};

const collectAdditionalWindows = (data: typeof OpenAIUsagePayload.Type): CollectedWindow[] =>
  (data.additional_rate_limits ?? []).flatMap((extra) => {
    const window = additionalWindow(extra);
    if (!window) return [];

    return [
      {
        requested: extra.name ?? extra.limit_name ?? label(window.limit_window_seconds ?? undefined),
        kind: "additional",
        window,
      },
    ];
  });

export const normalizeOpenAIUsage = (
  data: typeof OpenAIUsagePayload.Type,
  accountId: string,
  now: number,
) => {
  const windows: Record<string, UsageWindow> = Object.create(null);
  const usedIds = new Set<string>();
  const collectedWindows = [...collectPrimaryWindows(data), ...collectAdditionalWindows(data)];

  for (const { requested, kind, window } of collectedWindows) {
    const id = allocateWindowId(usedIds, requested, kind);
    usedIds.add(id);
    windows[id] = normalizeWindow(window, now);
  }

  return {
    accountId,
    provider: "openai-codex" as const,
    windows,
    updatedAt: now,
    plan: data.plan_type ?? data.plan ?? undefined,
  };
};
