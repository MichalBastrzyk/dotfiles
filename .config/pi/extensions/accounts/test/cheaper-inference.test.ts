import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import {
  emptyAccountsState,
  UsageAuthError,
  type CheaperInferenceAccount,
} from "../domain.ts";
import { decodeAccountsState } from "../storage/schema.ts";
import { makeCheaperInferenceProvider, localDateKey } from "../providers/cheaper-inference.ts";
import { makeAccountStore } from "../services/account-store.ts";
import { makeFileStore } from "../storage/file-store.ts";
import { makeCredentialService } from "../services/credential-service.ts";
import { makeSessionService } from "../services/session-service.ts";
import { makeAccountSelectionPolicy } from "../services/selection-policy.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiKeyLoginDialog, apiKeyLoginConfigFor } from "../ui/api-key-login.ts";
import { formatUsageSummary } from "../ui/account-row.ts";
import { PROVIDER_IDS } from "../providers/catalog.ts";
import { makeRuntimeAuthCoordinator } from "../services/runtime-auth.ts";
import {
  credentialKeyOf,
  fetchCheaperInferenceModels,
  mapCheaperInferenceCatalog,
  mapCheaperInferenceModel,
} from "../providers/cheaper-inference-models.ts";
import { makeCheaperInferenceModelSync } from "../services/model-sync.ts";

const account: CheaperInferenceAccount = {
  id: "personal",
  label: "Personal",
  key: "ci_live_valid",
  provider: "cheaper-inference",
  kind: "api-key",
  createdAt: 0,
  updatedAt: 0,
};

const modelsOk = () =>
  Promise.resolve(new Response(JSON.stringify({ object: "list", data: [{ id: "glm-5.3-flash" }] })));
const modelsUnauthorized = () =>
  Promise.resolve(new Response(JSON.stringify({ error: { message: "Invalid API key." } }), { status: 401 }));
const dailyOk = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({ object: "usage.daily", spend_usd: "12.84", total_requests: 1284 }),
    ),
  );
const dailyForbidden = () =>
  Promise.resolve(new Response(JSON.stringify({ error: { message: "Forbidden" } }), { status: 403 }));

describe("cheaper-inference catalog", () => {
  it("registers three providers with api-key auth for CheaperInference", () => {
    expect([...PROVIDER_IDS]).toEqual(["openai-codex", "opencode-go", "cheaper-inference"]);
  });

  it("describes the dashboard and required scopes for the setup dialog", () => {
    const config = apiKeyLoginConfigFor("cheaper-inference");
    expect(config.title).toBe("CheaperInference");
    expect(config.required).toContain("inference");
    expect(config.required).toContain("usage:read");
    expect(config.dashboardUrl).toContain("api.cheaperinference.com/dashboard/keys");
  });
});

describe("V1 -> V2 migration", () => {
  it("preserves OpenAI + OpenCode accounts and adds an empty cheaper-inference group", async () => {
    const oauth = (id: string) => ({
      id,
      provider: "openai-codex" as const,
      kind: "oauth" as const,
      label: id,
      credential: {
        type: "oauth" as const,
        access: `x.${Buffer.from(JSON.stringify({ sub: id, "https://api.openai.com/auth": { chatgpt_account_id: id } })).toString("base64url")}.y`,
        refresh: "y",
        expires: 1,
        accountId: id,
      },
      createdAt: 1,
      updatedAt: 1,
    });
    const v1 = {
      version: 1 as const,
      providers: {
        "openai-codex": { accounts: { a: oauth("a") } },
        "opencode-go": {
          accounts: {
            b: {
              id: "b",
              provider: "opencode-go" as const,
              kind: "api-key" as const,
              label: "b",
              key: "key-b",
              createdAt: 1,
              updatedAt: 1,
            },
          },
        },
      },
    };
    const migrated = decodeAccountsState(v1);
    expect(migrated.version).toBe(2);
    expect(Object.keys(migrated.providers["openai-codex"].accounts)).toEqual(["a"]);
    expect(Object.keys(migrated.providers["opencode-go"].accounts)).toEqual(["b"]);
    expect(migrated.providers["cheaper-inference"].accounts).toEqual({});
    expect(emptyAccountsState().version).toBe(2);
  });

  it("migrates a V1 file to V2 on first load and keeps V1 on disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-ci-migrate-"));
    try {
      const files = makeFileStore(root);
      await files.ensureDirs();
      const { writeFile } = await import("node:fs/promises");
      const v1 = {
        version: 1,
        providers: {
          "openai-codex": { accounts: {} },
          "opencode-go": {
            accounts: {
              work: {
                id: "work",
                provider: "opencode-go",
                kind: "api-key",
                label: "work",
                key: "k",
                createdAt: 1,
                updatedAt: 1,
              },
            },
          },
        },
      };
      await writeFile(files.legacyFile, JSON.stringify(v1), { mode: 0o600 });
      const loaded = await files.load();
      expect(loaded.version).toBe(2);
      expect(Object.keys(loaded.providers["opencode-go"].accounts)).toEqual(["work"]);
      const { readFile } = await import("node:fs/promises");
      const v2raw = JSON.parse(await readFile(files.file, "utf8"));
      expect(v2raw.version).toBe(2);
      const v1raw = JSON.parse(await readFile(files.legacyFile, "utf8"));
      expect(v1raw.version).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("CheaperInference provider", () => {
  it("saves a valid inference key validated via GET /v1/models", async () => {
    const seen: string[] = [];
    const store = {
      get: () => Effect.succeed(account),
      upsert: (a: CheaperInferenceAccount) => Effect.succeed(a),
    } as never;
    const provider = makeCheaperInferenceProvider({
      store,
      clock: { now: () => 1 },
      fetch: ((url: any) => {
        seen.push(String(url));
        return modelsOk();
      }) as never,
    });
    const saved = await Effect.runPromise(
      provider.createAccount({ id: "personal", label: "Personal", key: "ci_live_valid" }),
    );
    expect(saved.id).toBe("personal");
    expect(seen).toEqual(["https://api.cheaperinference.com/v1/models"]);
  });

  it("does not save an invalid key", async () => {
    const upsert = vi.fn((a: CheaperInferenceAccount) => Effect.succeed(a));
    const store = { get: () => Effect.succeed(account), upsert } as never;
    const provider = makeCheaperInferenceProvider({
      store,
      fetch: (() => modelsUnauthorized()) as never,
    });
    await expect(
      Effect.runPromise(
        provider.createAccount({ id: "bad", label: "Bad", key: "ci_live_bad" }),
      ),
    ).rejects.toBeInstanceOf(UsageAuthError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("validates via /v1/models even when usage:read is missing", async () => {
    const store = {
      get: () => Effect.succeed(account),
      upsert: (a: CheaperInferenceAccount) => Effect.succeed(a),
    } as never;
    const calls: string[] = [];
    const provider = makeCheaperInferenceProvider({
      store,
      fetch: ((url: any) => {
        calls.push(String(url));
        if (String(url).includes("/usage/")) return dailyForbidden();
        return modelsOk();
      }) as never,
    });
    await expect(Effect.runPromise(provider.validateAccount(account))).resolves.toBeUndefined();
    expect(calls).toEqual(["https://api.cheaperinference.com/v1/models"]);
  });

  it("returns spend summary instead of percentage quota", async () => {
    const store = { get: () => Effect.succeed(account) } as never;
    const provider = makeCheaperInferenceProvider({
      store,
      clock: { now: () => 7 },
      fetch: (() => dailyOk()) as never,
    });
    const usage = await Effect.runPromise(provider.getUsage(account, account.key));
    expect(usage.windows).toEqual({});
    expect(usage.summary).toMatchObject({ spendUsd: 12.84, requests: 1284 });
    expect(formatUsageSummary(usage.summary)).toBe("30d $12.84 · 1,284 req");
  });

  it("adds wallet balance from account:read and today's spend from daily_spend", async () => {
    const now = Date.UTC(2026, 8, 8, 12, 0, 0);
    const store = { get: () => Effect.succeed(account) } as never;
    const provider = makeCheaperInferenceProvider({
      store,
      clock: { now: () => now },
      fetch: ((url: any) => {
        if (String(url).includes("/account/balance"))
          return Promise.resolve(new Response(JSON.stringify({ available_usd: 14.899051 })));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              object: "usage.daily",
              spend_usd: "12.84",
              total_requests: 1284,
              daily_spend: [
                { date: "2026-09-07", spend_usd: "1.10" },
                { date: localDateKey(now), spend_usd: "0.038412" },
              ],
            }),
          ),
        );
      }) as never,
    });
    const usage = await Effect.runPromise(provider.getUsage(account, account.key));
    expect(usage.summary).toMatchObject({
      spendUsd: 12.84,
      spendUsdToday: 0.038412,
      requests: 1284,
      availableUsd: 14.899051,
    });
    expect(formatUsageSummary(usage.summary)).toBe(
      "$14.90 left · 30d $12.84 · today $0.0384 · 1,284 req",
    );
  });

  it("keeps spend when account:read is missing and hides only the balance", async () => {
    const store = { get: () => Effect.succeed(account) } as never;
    let calls = 0;
    const provider = makeCheaperInferenceProvider({
      store,
      clock: { now: () => 7 },
      fetch: ((url: any) => {
        calls++;
        if (String(url).includes("/account/balance"))
          return Promise.resolve(new Response(JSON.stringify({ error: {} }), { status: 403 }));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              object: "usage.daily",
              spend_usd: "12.84",
              total_requests: 1284,
              daily_spend: [{ date: localDateKey(7), spend_usd: "0.38" }],
            }),
          ),
        );
      }) as never,
    });
    const usage = await Effect.runPromise(provider.getUsage(account, account.key));
    expect(calls).toBe(2);
    expect(usage.summary).toMatchObject({ spendUsd: 12.84, spendUsdToday: 0.38, requests: 1284 });
    expect(usage.summary?.availableUsd).toBeUndefined();
    expect(formatUsageSummary(usage.summary)).toBe("30d $12.84 · today $0.3800 · 1,284 req");
  });

  it("shows balance alone when usage:read is missing", async () => {
    const store = { get: () => Effect.succeed(account) } as never;
    const provider = makeCheaperInferenceProvider({
      store,
      clock: { now: () => 7 },
      fetch: ((url: any) =>
        String(url).includes("/account/balance")
          ? Promise.resolve(new Response(JSON.stringify({ available_usd: 18.02 })))
          : Promise.resolve(new Response(JSON.stringify({ error: {} }), { status: 403 }))) as never,
    });
    const usage = await Effect.runPromise(provider.getUsage(account, account.key));
    expect(usage.summary).toEqual({ availableUsd: 18.02 });
    expect(formatUsageSummary(usage.summary)).toBe("$18.02 left");
  });

  it("propagates the daily error when both usage and balance are rejected", async () => {
    const store = { get: () => Effect.succeed(account) } as never;
    const provider = makeCheaperInferenceProvider({
      store,
      fetch: (() =>
        Promise.resolve(new Response(JSON.stringify({ error: {} }), { status: 403 }))) as never,
    });
    const error = await Effect.runPromise(
      Effect.flip(provider.getUsage(account, account.key)),
    );
    expect(error).toBeInstanceOf(UsageAuthError);
  });

  it("maps missing usage:read to unavailable without invalidating inference", async () => {
    const store = { get: () => Effect.succeed(account) } as never;
    const provider = makeCheaperInferenceProvider({
      store,
      fetch: (() => dailyForbidden()) as never,
    });
    await expect(Effect.runPromise(provider.getUsage(account, account.key))).rejects.toBeInstanceOf(
      UsageAuthError,
    );
    const validator = makeCheaperInferenceProvider({
      store,
      fetch: (() => modelsOk()) as never,
    });
    await expect(Effect.runPromise(validator.validateAccount(account))).resolves.toBeUndefined();
  });

  it("never includes the raw key in errors or logs", async () => {
    const secret = "ci_live_super_secret_123";
    const store = {
      get: () => Effect.succeed({ ...account, key: secret }),
      upsert: (a: CheaperInferenceAccount) => Effect.succeed(a),
    } as never;
    const provider = makeCheaperInferenceProvider({
      store,
      fetch: (() => modelsUnauthorized()) as never,
    });
    try {
      await Effect.runPromise(
        provider.createAccount({ id: "x", label: "X", key: secret }),
      );
      expect.unreachable();
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(String((error as any)?.message ?? "")).not.toContain(secret);
    }
  });
});

describe("CheaperInference store and credentials", () => {
  it("stores, retrieves, defaults, and removes a cheaper-inference account", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-ci-store-"));
    try {
      const store = makeAccountStore(makeFileStore(root));
      const saved = await Effect.runPromise(
        store.upsert({ ...account, id: "ai-lab", label: "AI Lab" }),
      );
      expect(saved.id).toBe("ai-lab");
      const fetched = await Effect.runPromise(store.get("cheaper-inference", saved.id));
      expect(fetched.id).toBe(saved.id);
      await Effect.runPromise(store.setDefault("cheaper-inference", saved.id));
      const state = await Effect.runPromise(store.load());
      expect(state.providers["cheaper-inference"].defaultAccount).toBe(saved.id);
      await Effect.runPromise(store.remove("cheaper-inference", saved.id));
      const after = await Effect.runPromise(store.load());
      expect(after.providers["cheaper-inference"].defaultAccount).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves api-key credentials via account kind without oauth", async () => {
    const store = {
      get: (provider: string, id: string) =>
        provider === "cheaper-inference"
          ? Effect.succeed(account)
          : Effect.fail(new Error("missing")),
    } as never;
    const service = makeCredentialService({
      store,
      oauth: { login: async () => { throw new Error("oauth must not be called"); } } as never,
      locksDir: tmpdir(),
    });
    expect(await Effect.runPromise(service.resolve("cheaper-inference", "personal"))).toBe(
      "ci_live_valid",
    );
  });

  it("keeps session selections per provider and drops them on fork", async () => {
    const manager = (id: string, entries: unknown[] = []) => ({
      id,
      entries,
      getSessionId() { return this.id; },
      getEntries() { return this.entries; },
      appendCustomEntry(customType: string, data: unknown) {
        this.entries.push({ type: "custom", customType, data });
      },
    });
    const m = manager("s");
    const session = makeSessionService(m);
    session.set("cheaper-inference", "lab");
    expect(session.get("cheaper-inference")).toBe("lab");
    const policy = makeAccountSelectionPolicy(session, emptyAccountsState());
    expect(policy.select("cheaper-inference")).toBe("lab");
    const fork = manager("fork", [...m.entries]);
    expect(makeSessionService(fork).get("cheaper-inference")).toBeUndefined();
  });
});

describe("CheaperInference runtime auth", () => {
  const runtimeFixture = () => {
    const runtime = new Map<string, string>();
    const calls: string[] = [];
    const registry = {
      runtime: {
        setRuntimeApiKey: async (provider: string, key: string) => {
          calls.push(`set:${provider}`);
          runtime.set(provider, key);
        },
        removeRuntimeApiKey: async (provider: string) => {
          calls.push(`remove:${provider}`);
          runtime.delete(provider);
        },
      },
      getApiKeyForProvider: async (provider: string) => runtime.get(provider),
      getRegisteredProviderConfig: () => undefined,
      unregisterProvider: async (provider: string) => {
        calls.push(`unregister:${provider}`);
      },
      registerProvider: async (provider: string) => {
        calls.push(`register:${provider}`);
      },
    };
    const keys = new Map([
      ["personal", "ci_live_personal"],
      ["ai-lab", "ci_live_lab"],
    ]);
    const credentials = {
      resolve: (provider: string, id: string) =>
        provider === "cheaper-inference" && keys.has(id)
          ? Effect.succeed(keys.get(id)!)
          : Effect.fail(new Error("missing")),
    } as never;
    const ctx = {
      modelRegistry: registry,
      model: { provider: "cheaper-inference", id: "glm-5.3-flash" },
      sessionManager: { getSessionId: () => "s" },
    };
    const coordinator = makeRuntimeAuthCoordinator({ ctx, credentials });
    return { runtime, calls, coordinator };
  };

  it("switches Personal -> AI Lab without restart and without provider overlay", async () => {
    const f = runtimeFixture();
    await Effect.runPromise(f.coordinator.activate("cheaper-inference", "personal"));
    expect(f.runtime.get("cheaper-inference")).toBe("ci_live_personal");
    await Effect.runPromise(f.coordinator.switchAccount("cheaper-inference", "ai-lab"));
    expect(f.runtime.get("cheaper-inference")).toBe("ci_live_lab");
    expect(f.coordinator.activeAccount("cheaper-inference")).toBe("ai-lab");
    expect(f.calls.some((c) => c.startsWith("unregister:") || c.startsWith("register:"))).toBe(false);
  });

  it("reactivates the selected account after a restart", async () => {
    const f = runtimeFixture();
    await Effect.runPromise(f.coordinator.ensureActive("cheaper-inference", "ai-lab"));
    expect(f.runtime.get("cheaper-inference")).toBe("ci_live_lab");
    const second = runtimeFixture();
    await Effect.runPromise(second.coordinator.ensureActive("cheaper-inference", "ai-lab"));
    expect(second.runtime.get("cheaper-inference")).toBe("ci_live_lab");
  });

  it("fail-closes with a sentinel when the active account is removed", async () => {
    const f = runtimeFixture();
    await Effect.runPromise(f.coordinator.activate("cheaper-inference", "personal"));
    await Effect.runPromise(f.coordinator.invalidate("cheaper-inference", "personal"));
    expect(f.coordinator.isBlocked("cheaper-inference")).toBe(true);
    expect(f.runtime.get("cheaper-inference")).toBe("pi-accounts-auth-failed");
  });

  it("never uses another provider key and never leaks the key in errors", async () => {
    const f = runtimeFixture();
    const flip = Effect.flip(f.coordinator.activate("cheaper-inference", "missing"));
    const error = await Effect.runPromise(flip);
    expect(String((error as any)?.message ?? "")).not.toContain("ci_live");
    expect(f.runtime.get("cheaper-inference")).toBeUndefined();
  });
});

describe("CheaperInference extension wiring", () => {
  it("clears cheaper-inference selection on fork and fail-closes without another key", async () => {
    const { createAccountsExtension } = await import("../extension.ts");
    const { ACCOUNTS_SELECTION_ENTRY } = await import("../services/session-service.ts");
    const commands = new Map<string, Function>();
    const handlers = new Map<string, Function[]>();
    const emitted: unknown[] = [];
    const pi = {
      registerCommand: (name: string, cmd: { handler: Function }) => commands.set(name, cmd.handler),
      on: (name: string, fn: Function) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
      events: { emit: (channel: string, value: unknown) => emitted.push([channel, value]) },
    };
    const runtime = new Map<string, string>();
    const lab: CheaperInferenceAccount = {
      id: "lab",
      label: "AI Lab",
      key: "ci_live_lab",
      provider: "cheaper-inference",
      kind: "api-key",
      createdAt: 0,
      updatedAt: 0,
    };
    const data = {
      ...emptyAccountsState(),
      providers: {
        ...emptyAccountsState().providers,
        "cheaper-inference": { accounts: { lab }, defaultAccount: "lab" },
      },
    };
    const store = {
      load: () => Effect.succeed(data),
      get: (provider: string, id: string) =>
        provider === "cheaper-inference" && id === "lab"
          ? Effect.succeed(lab)
          : Effect.fail(new Error("missing")),
      list: () => Effect.succeed([lab]),
    } as never;
    const ctx: any = {
      mode: "tui",
      model: { provider: "cheaper-inference", id: "glm-5.3-flash" },
      setModel: () => {},
      abort: () => {},
      hasUI: true,
      waitForIdle: async () => {},
      ui: { notify: () => {}, custom: async () => {}, confirm: async () => {}, select: async () => {}, input: async () => {} },
      sessionManager: { getSessionId: () => "s", getEntries: () => [], appendCustomEntry: () => {} },
      modelRegistry: {
        runtime: {
          setRuntimeApiKey: (p: string, k: string) => runtime.set(p, k),
          removeRuntimeApiKey: (p: string) => runtime.delete(p),
        },
        getApiKeyForProvider: (p: string) => runtime.get(p),
      },
    };
    createAccountsExtension({
      store,
      credentials: { resolve: (_p: string, id: string) => Effect.succeed(`${id}-runtime`) } as never,
      providers: new Map(),
      usage: { all: () => Effect.succeed([]) } as never,
    })(pi);
    await handlers.get("session_start")![0]!({ reason: "new" }, ctx);
    expect(runtime.get("cheaper-inference")).toBe("lab-runtime");
    const entries: any[] = [
      {
        type: "custom",
        customType: ACCOUNTS_SELECTION_ENTRY,
        data: { version: 1, ownerSessionId: "s", selections: { "cheaper-inference": "lab" } },
      },
    ];
    ctx.sessionManager.getEntries = () => entries;
    ctx.sessionManager.appendCustomEntry = (customType: string, data: unknown) =>
      entries.push({ type: "custom", customType, data });
    await handlers.get("session_start")![0]!({ reason: "fork" }, ctx);
    const latest = [...entries]
      .reverse()
      .find((entry) => entry.customType === ACCOUNTS_SELECTION_ENTRY);
    expect(latest.data.ownerSessionId).toBe("s");
    expect(latest.data.selections["cheaper-inference"]).toBeUndefined();
    await handlers.get("session_shutdown")![0]!();
    expect(runtime.has("cheaper-inference")).toBe(false);
  });

  it("background-activates CI on startup so its models list under another provider's model", async () => {
    const { createAccountsExtension } = await import("../extension.ts");
    const handlers = new Map<string, Function[]>();
    const pi = {
      registerCommand: () => {},
      on: (name: string, fn: Function) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
      events: { emit: () => {} },
    };
    const lab: CheaperInferenceAccount = {
      id: "lab",
      label: "AI Lab",
      key: "ci_live_lab",
      provider: "cheaper-inference",
      kind: "api-key",
      createdAt: 0,
      updatedAt: 0,
    };
    const data = {
      ...emptyAccountsState(),
      providers: {
        ...emptyAccountsState().providers,
        "cheaper-inference": { accounts: { lab }, defaultAccount: "lab" },
      },
    };
    const runtime = new Map<string, string>();
    const ctx: any = {
      mode: "tui",
      model: { provider: "opencode-go", id: "deepseek-v4-flash" },
      hasUI: false,
      sessionManager: { getSessionId: () => "s", getEntries: () => [], appendCustomEntry: () => {} },
      modelRegistry: {
        runtime: {
          setRuntimeApiKey: (p: string, k: string) => runtime.set(p, k),
          removeRuntimeApiKey: (p: string) => runtime.delete(p),
        },
        getApiKeyForProvider: (p: string) => runtime.get(p),
      },
    };
    const synced: Array<string | undefined> = [];
    createAccountsExtension({
      store: {
        load: () => Effect.succeed(data),
        get: () => Effect.succeed(lab),
        list: () => Effect.succeed([lab]),
      } as never,
      credentials: { resolve: () => Effect.succeed("ci_live_lab") } as never,
      providers: new Map(),
      usage: { all: () => Effect.succeed([]) } as never,
      syncCheaperInferenceModels: (id?: string) => synced.push(id),
    })(pi);
    await handlers.get("session_start")![0]!({ reason: "new" }, ctx);
    expect(synced).toEqual(["lab"]);
    expect(runtime.get("cheaper-inference")).toBe("ci_live_lab");
    expect(runtime.has("opencode-go")).toBe(false);
    await handlers.get("session_shutdown")![0]!();
    expect(runtime.has("cheaper-inference")).toBe(false);
  });

  it("broadcasts spend summary for the footer instead of percentage quota", async () => {
    const { createAccountsExtension } = await import("../extension.ts");
    const emitted: Array<[string, any]> = [];
    const pi = {
      registerCommand: () => {},
      on: (name: string, fn: Function) => {
        (pi as any)[name] = fn;
      },
      events: { emit: (c: string, v: unknown) => emitted.push([c, v]) },
    };
    const lab: CheaperInferenceAccount = {
      id: "lab",
      label: "AI Lab",
      key: "ci_live_lab",
      provider: "cheaper-inference",
      kind: "api-key",
      createdAt: 0,
      updatedAt: 0,
    };
    const data = {
      ...emptyAccountsState(),
      providers: {
        ...emptyAccountsState().providers,
        "cheaper-inference": { accounts: { lab }, defaultAccount: "lab" },
      },
    };
    const runtime = new Map<string, string>();
    const ctx: any = {
      mode: "tui",
      model: { provider: "cheaper-inference", id: "glm-5.3-flash" },
      hasUI: false,
      sessionManager: { getSessionId: () => "s", getEntries: () => [], appendCustomEntry: () => {} },
      modelRegistry: {
        runtime: {
          setRuntimeApiKey: (p: string, k: string) => runtime.set(p, k),
          removeRuntimeApiKey: (p: string) => runtime.delete(p),
        },
        getApiKeyForProvider: (p: string) => runtime.get(p),
      },
    };
    createAccountsExtension({
      store: {
        load: () => Effect.succeed(data),
        get: () => Effect.succeed(lab),
        list: () => Effect.succeed([lab]),
      } as never,
      credentials: { resolve: () => Effect.succeed("ci_live_lab") } as never,
      providers: new Map(),
      usage: {
        all: () =>
          Effect.succeed([
            {
              accountId: "lab",
              provider: "cheaper-inference",
              windows: {},
              updatedAt: 0,
              summary: { spendUsd: 12.84, requests: 1284 },
            },
          ]),
      } as never,
    })(pi);
    await (pi as any)["session_start"]({ reason: "new" }, ctx);
    await vi.waitFor(() => expect(emitted.length).toBeGreaterThan(0));
    const info = emitted.find(([c]) => c === "dashboard:accounts-info")?.[1]?.[0];
    expect(info?.summary).toMatchObject({ spendUsd: 12.84, requests: 1284 });
    expect(info?.windows).toEqual([]);
    await (pi as any)["session_shutdown"]();
  });
});

describe("CheaperInference model catalog", () => {
  it("maps the flat public shape with costs and vision", () => {
    const model = mapCheaperInferenceModel({
      id: "glm-5.3-flash",
      model_type: "text",
      input_per_million: "0.060426",
      output_per_million: "0.201421",
      cache_read_per_million: "0.012085",
      cache_write_per_million: "0.060426",
      context_length: 1048576,
      max_output_tokens: 131072,
      supports_vision: true,
      supports_reasoning: true,
    });
    expect(model).toMatchObject({
      id: "glm-5.3-flash",
      name: "glm-5.3-flash",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0.060426, output: 0.201421, cacheRead: 0.012085, cacheWrite: 0.060426 },
      contextWindow: 1048576,
      maxTokens: 131072,
    });
  });

  it("maps the nested /v1 shape and skips image/video generation models", () => {
    const models = mapCheaperInferenceCatalog({
      object: "list",
      data: [
        {
          id: "gpt-5.4",
          type: "text",
          context_length: 1000000,
          max_output_tokens: 131072,
          capabilities: { vision: false, reasoning: true },
          pricing: { input_per_million: "1.75", output_per_million: "10.5" },
        },
        { id: "nano-banana", type: "image" },
        { id: "seedance-2.0", type: "video" },
        { id: "" },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(["gpt-5.4"]);
    expect(models[0]?.compat).toMatchObject({
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
    });
  });

  it("fetches with Bearer auth and surfaces auth failures without the key", async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetcher = (async (url: any, init?: any) => {
      seen.push({ url: String(url), auth: init?.headers?.Authorization ?? null });
      return new Response(JSON.stringify({ object: "list", data: [{ id: "b", model_type: "text" }] }));
    }) as never;
    const models = await fetchCheaperInferenceModels({ key: "ci_live_x", fetcher });
    expect(models.map((m) => m.id)).toEqual(["b"]);
    expect(seen[0]?.auth).toBe("Bearer ci_live_x");
    const failing = (async () =>
      new Response(JSON.stringify({ error: { message: "Invalid API key." } }), { status: 401 })) as never;
    await expect(fetchCheaperInferenceModels({ key: "ci_live_bad", fetcher: failing })).rejects.toThrow(
      "credentials were rejected",
    );
  });

  it("extracts the key only from api_key credentials", () => {
    expect(credentialKeyOf({ type: "api_key", key: "ci_live_x" })).toBe("ci_live_x");
    expect(credentialKeyOf({ type: "oauth", access: "a" })).toBeUndefined();
    expect(credentialKeyOf(undefined)).toBeUndefined();
  });
});

const ciLabAccount = {
  id: "lab",
  label: "AI Lab",
  key: "ci_live_lab",
  provider: "cheaper-inference" as const,
  kind: "api-key" as const,
  createdAt: 0,
  updatedAt: 0,
};
const ciSyncHarness = (options: { accounts?: typeof ciLabAccount[]; defaultAccount?: string } = {}) => {
    const registered: Array<{ name: string; config: any }> = [];
    const pi = { registerProvider: (name: string, config: any) => registered.push({ name, config }) };
    const credentials = {
      resolve: (provider: string, id: string) =>
        provider === "cheaper-inference" && (options.accounts ?? [ciLabAccount]).some((a) => a.id === id)
          ? Effect.succeed(`ci_live_${id}`)
          : Effect.fail(new Error("missing")),
    } as never;
    const state = {
      ...emptyAccountsState(),
      providers: {
        ...emptyAccountsState().providers,
        "cheaper-inference": {
          accounts: Object.fromEntries((options.accounts ?? [ciLabAccount]).map((a) => [a.id, a])),
          defaultAccount: options.defaultAccount ?? (options.accounts ?? [ciLabAccount])[0]?.id,
        },
      },
    };
    const store = { load: () => Effect.succeed(state) } as never;
    let fetches = 0;
    const fetcher = (async () => {
      fetches++;
      return new Response(JSON.stringify({ object: "list", data: [{ id: "glm-5.3-flash", model_type: "text" }] }));
    }) as never;
    let nowMs = 1_000_000;
    const sync = makeCheaperInferenceModelSync({
      pi,
      store,
      credentials,
      fetch: fetcher,
      now: () => nowMs,
    });
    return { registered, pi, store, credentials, fetcher, sync, fetches: () => fetches, advance: (ms: number) => { nowMs += ms; } };
  };

describe("CheaperInference model sync", () => {
  it("registers the provider without apiKey and publishes fetched models on account sync", async () => {
    const { registered, sync } = ciSyncHarness();
    sync.register();
    expect(registered[0]?.name).toBe("cheaper-inference");
    expect(registered[0]?.config.baseUrl).toContain("api.cheaperinference.com/v1");
    expect(registered[0]?.config).not.toHaveProperty("apiKey");
    expect(registered[0]?.config.models).toEqual([]);
    expect(typeof registered[0]?.config.refreshModels).toBe("function");
    await sync.syncAccount("lab");
    expect(registered.at(-1)?.config.models.map((m: { id: string }) => m.id)).toEqual([
      "glm-5.3-flash",
    ]);
  });

  it("refreshes from the effective credential and keeps the list on failure", async () => {
    const { registered, sync } = ciSyncHarness({ accounts: [] });
    await sync.syncAccount("missing");
    expect(registered).toHaveLength(0);
    expect(await sync.refresh({ credential: undefined, signal: new AbortController().signal })).toEqual([]);
    const models = await sync.refresh({
      credential: { type: "api_key", key: "ci_live_x" },
      signal: new AbortController().signal,
    });
    expect(models.map((m) => m.id)).toEqual(["glm-5.3-flash"]);
  });

  it("falls back to the accounts store when Pi has no stored credential", async () => {
    const { sync } = ciSyncHarness();
    const models = await sync.refresh({
      credential: undefined,
      signal: new AbortController().signal,
    });
    expect(models.map((m) => m.id)).toEqual(["glm-5.3-flash"]);
  });

  it("syncs the default account on startup, throttled", async () => {
    const h = ciSyncHarness();
    await h.sync.syncAccount(undefined);
    expect(h.fetches()).toBe(1);
    expect(h.registered.at(-1)?.config.models.map((m: { id: string }) => m.id)).toEqual([
      "glm-5.3-flash",
    ]);
    await h.sync.syncAccount(undefined);
    expect(h.fetches()).toBe(1);
    h.advance(6 * 60 * 1000);
    await h.sync.syncAccount(undefined);
    expect(h.fetches()).toBe(2);
  });

  it("always refetches an explicit account even inside the throttle window", async () => {
    const h = ciSyncHarness();
    await h.sync.syncAccount(undefined);
    await h.sync.syncAccount("lab");
    expect(h.fetches()).toBe(2);
  });

  it("startup sync is a no-op without accounts", async () => {
    const h = ciSyncHarness({ accounts: [] });
    await h.sync.syncAccount(undefined);
    expect(h.fetches()).toBe(0);
    expect(h.registered).toHaveLength(0);
  });

  it("serves the last-known list during the cache-only phase without fetching", async () => {
    let fetched = 0;
    const countingFetch = (async () => {
      fetched++;
      return new Response(JSON.stringify({ object: "list", data: [] }));
    }) as never;
    const withCountingFetch = makeCheaperInferenceModelSync({
      pi: { registerProvider: () => {} },
      store: { load: () => Effect.succeed(emptyAccountsState()) } as never,
      credentials: { resolve: () => Effect.fail(new Error("missing")) } as never,
      fetch: countingFetch,
    });
    expect(
      await withCountingFetch.refresh({
        credential: { type: "api_key", key: "ci_live_x" },
        signal: new AbortController().signal,
        allowNetwork: false,
      }),
    ).toEqual([]);
    expect(fetched).toBe(0);
    const { sync } = ciSyncHarness();
    await sync.syncAccount("lab");
    expect(
      await sync.refresh({ credential: undefined, signal: new AbortController().signal, allowNetwork: false }),
    ).toEqual([expect.objectContaining({ id: "glm-5.3-flash" })]);
  });

  it("keeps the last-known list when a refresh fetch fails", async () => {
    const { sync } = ciSyncHarness();
    await sync.syncAccount("lab");
    const failing = makeCheaperInferenceModelSync({
      pi: { registerProvider: () => {} },
      store: { load: () => Effect.fail(new Error("missing")) } as never,
      credentials: { resolve: () => Effect.fail(new Error("missing")) } as never,
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 })) as never,
    });
    await expect(
      failing.refresh({
        credential: { type: "api_key", key: "ci_live_x" },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("HTTP 500");
    expect(
      await sync.refresh({ credential: undefined, signal: new AbortController().signal, allowNetwork: false }),
    ).toEqual([expect.objectContaining({ id: "glm-5.3-flash" })]);
  });

  it("surfaces fetch failures with a key so /model shows cached models", async () => {
    const { sync } = ciSyncHarness();
    const failing = makeCheaperInferenceModelSync({
      pi: { registerProvider: () => {} },
      store: { load: () => Effect.fail(new Error("missing")) } as never,
      credentials: { resolve: () => Effect.fail(new Error("missing")) } as never,
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "Invalid API key." } }), { status: 401 })) as never,
    });
    await expect(
      failing.refresh({
        credential: { type: "api_key", key: "ci_live_revoked" },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("credentials were rejected");
    expect(await sync.refresh({ credential: undefined, signal: new AbortController().signal })).not.toEqual([]);
  });
});

describe("CheaperInference model cache", () => {
  it("seeds registration from cache and persists successful syncs", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { readModelCache } = await import("../storage/model-cache.ts");
    const root = await mkdtemp(join(tmpdir(), "pi-ci-cache-"));
    try {
      expect(await readModelCache(root)).toEqual([]);
      const registered: Array<{ name: string; config: any }> = [];
      const h = ciSyncHarness();
      const sync = makeCheaperInferenceModelSync({
        pi: { registerProvider: (n: string, c: any) => registered.push({ name: n, config: c }) },
        store: h.store,
        credentials: h.credentials,
        fetch: h.fetcher,
        cacheRoot: root,
      });
      await sync.syncAccount("lab");
      expect(await readModelCache(root)).toEqual([expect.objectContaining({ id: "glm-5.3-flash" })]);
      const reloaded = makeCheaperInferenceModelSync({
        pi: { registerProvider: (n: string, c: any) => registered.push({ name: n, config: c }) },
        store: h.store,
        credentials: h.credentials,
        fetch: h.fetcher,
        cacheRoot: root,
        initialModels: await readModelCache(root),
      });
      reloaded.register();
      expect(registered.at(-1)?.config.models.map((m: { id: string }) => m.id)).toEqual([
        "glm-5.3-flash",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats a corrupt cache as empty", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { readModelCache } = await import("../storage/model-cache.ts");
    const root = await mkdtemp(join(tmpdir(), "pi-ci-cache-"));
    try {
      await writeFile(join(root, "cheaper-inference-models.json"), "nope");
      expect(await readModelCache(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("CheaperInference api-key dialog", () => {
  it("renders setup instructions without ever showing the secret", () => {
    const config = apiKeyLoginConfigFor("cheaper-inference");
    const dialog = new ApiKeyLoginDialog({
      config,
      theme: { fg: (_c: string, t: string) => t },
      requestRender: () => {},
      onDone: () => {},
    });
    dialog.handleInput("c");
    dialog.handleInput("i");
    const rendered = dialog.render(80).join("\n");
    expect(rendered).toContain("CheaperInference");
    expect(rendered).toContain("inference + usage:read");
    expect(rendered).toContain("Open API Keys");
    expect(rendered).not.toContain("ci");
    dialog.dispose();
  });

  it("opens the dashboard with o only when the input is empty", () => {
    const config = apiKeyLoginConfigFor("cheaper-inference");
    const opened: string[] = [];
    const noop = () => {};
    const dialog = new ApiKeyLoginDialog({
      config,
      requestRender: noop,
      onDone: noop,
      openUrl: (url) => opened.push(url),
    });
    dialog.handleInput("o");
    expect(opened).toHaveLength(1);
    dialog.handleInput("x");
    dialog.handleInput("o");
    expect(opened).toHaveLength(1);
    dialog.dispose();
  });
});
