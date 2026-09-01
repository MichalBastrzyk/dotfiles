import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { makeRuntimeAuthCoordinator, RuntimeActivationError } from "../services/runtime-auth.ts";
import type { ProviderId } from "../domain.ts";

const fixture = (options: { failSet?: (key: string) => boolean; mismatch?: (key: string) => boolean; cleanup?: (id: string) => unknown; withoutSession?: boolean; builtinWithStoredOAuth?: boolean } = {}) => {
  const pristine = { baseUrl: "https://example.test", models: [{ id: "gpt" }] };
  let config: Record<string, unknown> | undefined = options.builtinWithStoredOAuth ? undefined : pristine;
  const runtime = new Map<string, string>();
  const calls: string[] = [];
  const registry = {
    runtime: {
      setRuntimeApiKey: async (provider: string, key: string) => {
        calls.push(`set:${provider}:${key}`);
        if (options.failSet?.(key)) throw new Error("secret must not escape");
        runtime.set(provider, key);
      },
      removeRuntimeApiKey: async (provider: string) => { calls.push(`remove:${provider}`); runtime.delete(provider); },
    },
    getApiKeyForProvider: async (provider: string) => {
      const resolved = options.builtinWithStoredOAuth ? (config?.apiKey as string | undefined) ?? "stored-oauth-key" : runtime.get(provider);
      return options.mismatch?.(runtime.get(provider) ?? "") ? "other" : resolved;
    },
    getRegisteredProviderConfig: () => config,
    unregisterProvider: async (provider: string) => { calls.push(`unregister:${provider}`); config = undefined; },
    registerProvider: async (provider: string, value: Record<string, unknown>) => { calls.push(`register:${provider}`); config = value; },
  };
  const credentials = { resolve: (provider: ProviderId, id: string) => id === "missing" ? Effect.fail(new Error("token text")) : Effect.succeed(`${id}-key`) };
  const ctx = { modelRegistry: registry, model: { provider: "openai-codex", id: "gpt" }, ...(options.withoutSession ? {} : { sessionManager: { getSessionId: () => "session-now" } }) };
  const coordinator = makeRuntimeAuthCoordinator({ ctx, credentials, cleanupSessionResources: options.cleanup });
  return { coordinator, ctx, runtime, calls, pristine, config: () => config };
};

const runFail = (effect: Effect.Effect<unknown, unknown>) => Effect.runPromise(Effect.flip(effect));

describe("runtime auth coordinator", () => {
  it("switches Personal to Work without changing the model and resolves Work", async () => {
    const f = fixture();
    await Effect.runPromise(f.coordinator.activate("openai-codex", "Personal"));
    await Effect.runPromise(f.coordinator.switchAccount("openai-codex", "Work"));
    expect(f.ctx.model).toEqual({ provider: "openai-codex", id: "gpt" });
    expect(f.runtime.get("openai-codex")).toBe("Work-key");
    expect(f.coordinator.activeAccount("openai-codex")).toBe("Work");
    expect(f.config()).toEqual({ ...f.pristine, apiKey: "Work-key" });
  });

  it("overlays the builtin provider when stored OAuth would mask the runtime key", async () => {
    const f = fixture({ builtinWithStoredOAuth: true });
    await Effect.runPromise(f.coordinator.activate("openai-codex", "Personal"));
    expect(f.runtime.get("openai-codex")).toBe("Personal-key");
    expect(f.calls).toContain("unregister:openai-codex");
    expect(f.calls).toContain("register:openai-codex");
    expect(f.config()).toEqual({ apiKey: "Personal-key" });
    await Effect.runPromise(f.coordinator.clear("openai-codex"));
    expect(f.config()).toBeUndefined();
  });

  it("resolve and validation failures mutate nothing", async () => {
    const f = fixture();
    await Effect.runPromise(f.coordinator.activate("openai-codex", "Personal"));
    const before = [...f.calls];
    await runFail(f.coordinator.activate("openai-codex", "missing"));
    expect(f.calls).toEqual(before);
    expect(f.coordinator.activeAccount("openai-codex")).toBe("Personal");
    const validating = makeRuntimeAuthCoordinator({ ctx: f.ctx, credentials: { resolve: () => Effect.succeed("new-key") }, validate: () => Effect.fail("no") });
    await runFail(validating.activate("opencode-go", "Work"));
    expect(f.runtime.has("opencode-go")).toBe(false);
  });

  it.each(["set", "probe"])("rolls back owned key, pristine-based overlay and active account on %s failure", async (kind) => {
    const f = fixture({ failSet: (key) => kind === "set" && key === "Work-key", mismatch: (key) => kind === "probe" && key === "Work-key" });
    await Effect.runPromise(f.coordinator.activate("openai-codex", "Personal"));
    const error = await runFail(f.coordinator.activate("openai-codex", "Work"));
    expect(error).toBeInstanceOf(RuntimeActivationError);
    expect(error).not.toHaveProperty("message", expect.stringContaining("secret"));
    expect(f.runtime.get("openai-codex")).toBe("Personal-key");
    expect(f.config()).toEqual({ ...f.pristine, apiKey: "Personal-key" });
    expect(f.coordinator.activeAccount("openai-codex")).toBe("Personal");
  });

  it("cleans once only after an OpenAI identity change without rolling back cleanup failure", async () => {
    const cleanup = vi.fn<(id: string) => unknown>();
    const f = fixture({ cleanup });
    await Effect.runPromise(f.coordinator.activate("openai-codex", "Personal"));
    await Effect.runPromise(f.coordinator.activate("openai-codex", "Personal"));
    await Effect.runPromise(f.coordinator.activate("openai-codex", "Work"));
    expect(cleanup).toHaveBeenCalledOnce(); expect(cleanup).toHaveBeenCalledWith("session-now");
    cleanup.mockImplementation(() => { throw new Error("cleanup"); });
    await Effect.runPromise(f.coordinator.activate("openai-codex", "Other"));
    expect(f.coordinator.activeAccount("openai-codex")).toBe("Other");
    expect(f.runtime.get("openai-codex")).toBe("Other-key");
  });

  it("does not run global cleanup when no session id is available", async () => {
    const cleanup = vi.fn(), f = fixture({ cleanup, withoutSession: true });
    await Effect.runPromise(f.coordinator.activate("openai-codex", "Personal"));
    await Effect.runPromise(f.coordinator.activate("openai-codex", "Work"));
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("ensureActive blocks with sentinel on missing credentials", async () => {
    const f = fixture();
    await runFail(f.coordinator.ensureActive("openai-codex", "missing"));
    expect(f.coordinator.isBlocked("openai-codex")).toBe(true);
    expect(f.runtime.get("openai-codex")).toBe("pi-accounts-auth-failed");
    expect(f.config()).toBe(f.pristine);
  });

  it("stays blocked when installing the failure sentinel throws", async () => {
    const f = fixture({ failSet: (key) => key === "pi-accounts-auth-failed" });
    await runFail(f.coordinator.ensureActive("openai-codex", "missing"));
    expect(f.coordinator.isBlocked("openai-codex")).toBe(true);
    expect(f.coordinator.activeAccount("openai-codex")).toBeUndefined();
  });

  it("clear ignores untouched providers and restores exact pristine config after a touch", async () => {
    const untouched = fixture();
    await Effect.runPromise(untouched.coordinator.clear("openai-codex"));
    expect(untouched.calls).toEqual([]);
    const f = fixture();
    await Effect.runPromise(f.coordinator.activate("openai-codex", "Personal"));
    await Effect.runPromise(f.coordinator.clear("openai-codex"));
    expect(f.config()).toBe(f.pristine);
    expect(f.runtime.has("openai-codex")).toBe(false);
  });

  it("serializes concurrent work for the same provider", async () => {
    const f = fixture();
    await Promise.all([Effect.runPromise(f.coordinator.activate("opencode-go", "one")), Effect.runPromise(f.coordinator.activate("opencode-go", "two"))]);
    expect(f.runtime.get("opencode-go")).toBe("two-key");
    expect(f.coordinator.activeAccount("opencode-go")).toBe("two");
  });

  it("never overlays or cleans up OpenCode", async () => {
    const cleanup = vi.fn(); const f = fixture({ cleanup });
    await Effect.runPromise(f.coordinator.activate("opencode-go", "one"));
    await Effect.runPromise(f.coordinator.activate("opencode-go", "two"));
    expect(f.calls.some((x) => x.startsWith("register:") || x.startsWith("unregister:"))).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();
  });
});
