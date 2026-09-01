import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { makeOpenAIProvider, type NativeOAuthCredential, type NativeOpenAIOAuth } from "../providers/openai-codex.ts";
import { normalizeOpenAIUsage } from "../providers/openai-usage.ts";
import { AccountNotFoundError, CredentialRefreshError, UsageAuthError, UsageHttpError, type OpenAIAccount } from "../domain.ts";
import { makeCredentialService } from "../services/credential-service.ts";

const account: OpenAIAccount = { id: "a", label: "test", provider: "openai-codex", kind: "oauth", credential: { type: "oauth", access: "fake", refresh: "fake-refresh", expires: 1, accountId: "external" }, createdAt: 0, updatedAt: 0 };
const store = { upsert: (a: OpenAIAccount) => Effect.succeed(a) } as never;
const oauth: NativeOpenAIOAuth = { login: async () => account.credential, refresh: async () => account.credential, toAuth: async (credential) => ({ apiKey: credential.access }) };
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("OpenAI usage", () => {
  it.each([
    {
      name: "uses top-level windows and the legacy plan field",
      payload: { plan: "legacy", primary_window: { used_percent: -1, limit_window_seconds: 60, reset_after_seconds: 2 } },
      expected: { plan: "legacy", windows: { "60s": { used: 0, limit: 100, resetsAt: 3_000 } } },
    },
    {
      name: "prefers nested windows over top-level windows",
      payload: {
        rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 60 } },
        primary_window: { used_percent: 90, limit_window_seconds: 120 },
      },
      expected: { plan: undefined, windows: { "60s": { used: 10, limit: 100, resetsAt: undefined } } },
    },
    {
      name: "falls back to top-level windows when nested windows are null",
      payload: {
        rate_limit: { primary_window: null, secondary_window: null },
        primary_window: { used_percent: 10, limit_window_seconds: 60 },
        secondary_window: { used_percent: 20, limit_window_seconds: 120 },
      },
      expected: { plan: undefined, windows: {
        "60s": { used: 10, limit: 100, resetsAt: undefined },
        "120s": { used: 20, limit: 100, resetsAt: undefined },
      } },
    },
    {
      name: "uses flat additional fields and allocates repeated ids",
      payload: { additional_rate_limits: [
        { name: "extra", used_percent: 1 },
        { name: "extra", used_percent: 2 },
        { name: "extra", used_percent: 3 },
      ] },
      expected: { plan: undefined, windows: {
        extra: { used: 1, limit: 100, resetsAt: undefined },
        "extra-additional": { used: 2, limit: 100, resetsAt: undefined },
        "extra-additional-2": { used: 3, limit: 100, resetsAt: undefined },
      } },
    },
  ])("normalizer $name", ({ payload, expected }) => {
    const usage = normalizeOpenAIUsage(payload, "account", 1_000);
    expect({ plan: usage.plan, windows: usage.windows }).toEqual(expected);
  });

  it("normalizes primary, secondary, additional windows and preserves duplicate ids", async () => {
    const body = { plan_type: "test-plan", rate_limit: {
      primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_after_seconds: 2 },
      secondary_window: { used_percent: 20, limit_window_seconds: 18000, reset_at: 3 },
    }, additional_rate_limits: [{ name: "5h", used_percent: 150, limit_window_seconds: 18000 }] };
    const provider = makeOpenAIProvider({ store, oauth, resolveCredential: () => Effect.succeed("fake"), clock: { now: () => 1_000 }, fetch: async () => new Response(JSON.stringify(body)) });
    const usage = await Effect.runPromise(provider.getUsage(account, "fake"));
    expect(usage.plan).toBe("test-plan");
    expect(usage.windows).toEqual({
      "5h": { used: 10, limit: 100, resetsAt: 3_000 },
      "5h-secondary": { used: 20, limit: 100, resetsAt: 3_000 },
      "5h-additional": { used: 100, limit: 100, resetsAt: undefined },
    });
  });
  it("preserves usage window ids that match object prototype keys", async () => {
    const body = { additional_rate_limits: [
      { name: "toString", used_percent: 10, limit_window_seconds: 60 },
      { name: "__proto__", used_percent: 20, limit_window_seconds: 120 },
    ] };
    const provider = makeOpenAIProvider({ store, oauth, resolveCredential: () => Effect.succeed("fake"), fetch: async () => new Response(JSON.stringify(body)) });
    const usage = await Effect.runPromise(provider.getUsage(account, "fake"));
    expect(Object.keys(usage.windows)).toEqual(["toString", "__proto__"]);
  });
  it("decodes the real team payload with null rate-limit fields", async () => {
    const body = {
      user_id: "user-x", account_id: "acc-x", email: "x@example.com", plan_type: "team",
      rate_limit: {
        allowed: false, limit_reached: true,
        primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_after_seconds: 9976, reset_at: 1788228391 },
        secondary_window: { used_percent: 16, limit_window_seconds: 604800, reset_after_seconds: 596776, reset_at: 1788815191 },
      },
      code_review_rate_limit: null, additional_rate_limits: null,
      credits: { has_credits: false, unlimited: false, overage_limit_reached: false, balance: null, approx_local_messages: null, approx_cloud_messages: null },
    };
    const provider = makeOpenAIProvider({ store, oauth, resolveCredential: () => Effect.succeed("fake"), clock: { now: () => 1_000 }, fetch: async () => new Response(JSON.stringify(body)) });
    const usage = await Effect.runPromise(provider.getUsage(account, "fake"));
    expect(usage.plan).toBe("team");
    expect(usage.windows["5h"]).toMatchObject({ used: 100, resetsAt: 1_788_228_391_000 });
    expect(usage.windows["weekly"]).toMatchObject({ used: 16, resetsAt: 1_788_815_191_000 });
  });
});

describe("OpenAI validation", () => {
  const providerForStatus = (status: number) => makeOpenAIProvider({
    store, oauth, resolveCredential: () => Effect.succeed("fake"),
    fetch: async () => new Response("status", { status }),
  });

  it("allows switching through a temporarily unavailable usage endpoint", async () => {
    await expect(Effect.runPromise(providerForStatus(503).validateAccount(account))).resolves.toBeUndefined();
  });
  it("still rejects authentication and non-retryable HTTP failures", async () => {
    await expect(Effect.runPromise(providerForStatus(401).validateAccount(account))).rejects.toBeInstanceOf(UsageAuthError);
    await expect(Effect.runPromise(providerForStatus(500).validateAccount(account))).rejects.toBeInstanceOf(UsageHttpError);
  });
});

describe("OpenAI login", () => {
  it("passes the native interaction, verifies async request auth, and persists the login credential", async () => {
    const credential = { ...account.credential, access: "oauth-access" };
    const interaction = { signal: new AbortController().signal, prompt: async () => "", notify: () => {} };
    const login = vi.fn(async () => credential);
    const toAuth = vi.fn(async () => ({ apiKey: "request-key" }));
    const upsert = vi.fn((value: OpenAIAccount) => Effect.succeed(value));
    const provider = makeOpenAIProvider({ store: { upsert } as never, oauth: { login, refresh: async () => credential, toAuth }, resolveCredential: () => Effect.succeed("") });
    const created = await Effect.runPromise(provider.createAccount({ id: "a", label: "test", interaction }));
    expect(login).toHaveBeenCalledWith(interaction);
    expect(toAuth).toHaveBeenCalledWith(credential);
    expect(created.credential.access).toBe("oauth-access");
  });
});

describe("credential provider matching", () => {
  it("fails in the Effect channel when the stored account provider differs", async () => {
    const locksDir = await mkdtemp(join(tmpdir(), "pi-credential-test-")); roots.push(locksDir);
    const service = makeCredentialService({
      store: { get: () => Effect.succeed(account) } as never,
      locksDir,
      oauth,
    });
    await expect(Effect.runPromise(service.resolve("opencode-go", "a"))).rejects.toBeInstanceOf(AccountNotFoundError);
  });
});

describe("OpenAI credential rotation", () => {
  const setup = async (
    refresh: (credential: NativeOAuthCredential, signal: AbortSignal) => Promise<NativeOAuthCredential>,
    toAuth = async (credential: NativeOAuthCredential) => ({ apiKey: credential.access }),
    initial = account,
    onUpdate?: (credential: OpenAIAccount["credential"]) => void,
    refreshTimeoutMs?: number,
  ) => {
    let saved = initial;
    const store = {
      get: () => Effect.succeed(saved),
      updateCredential: (_provider: string, _id: string, credential: OpenAIAccount["credential"]) => Effect.sync(() => { saved = { ...saved, credential }; onUpdate?.(credential); return saved; }),
    } as never;
    const locksDir = await mkdtemp(join(tmpdir(), "pi-credential-test-")); roots.push(locksDir);
    const service = makeCredentialService({ store, locksDir, clock: { now: () => 1_000 }, oauth: { login: async () => account.credential, refresh, toAuth }, refreshTimeoutMs });
    return { service, saved: () => saved };
  };
  it("rotates expired credentials once and persists only declared credential fields", async () => {
    const rotated = { type: "oauth" as const, access: "new-access", refresh: "new-refresh", expires: 999_999, accountId: "external", providerState: "must-not-persist" };
    const credential = { type: "oauth" as const, access: "new-access", refresh: "new-refresh", expires: 999_999, accountId: "external" };
    const refresh = vi.fn(async (_credential, _signal: AbortSignal) => rotated);
    const toAuth = vi.fn(async () => ({ apiKey: "request-key" }));
    const { service, saved } = await setup(refresh, toAuth);
    expect(await Promise.all([1, 2, 3].map(() => Effect.runPromise(service.resolve("openai-codex", "a"))))).toEqual(["request-key", "request-key", "request-key"]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh.mock.calls[0]?.[0]).toEqual(account.credential);
    expect(refresh.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect(toAuth).toHaveBeenCalledWith(credential);
    expect(saved().credential).toEqual(credential);
  });
  it("persists rotated credentials before deriving the API key", async () => {
    const rotated = { ...account.credential, access: "new-access", refresh: "new-refresh", expires: 999_999 };
    let persisted: OpenAIAccount["credential"] | undefined;
    const { service } = await setup(async () => rotated, async (credential) => {
      expect(persisted).toEqual(credential);
      return { apiKey: "request-key" };
    }, account, (credential) => { persisted = credential; });
    expect(await Effect.runPromise(service.resolve("openai-codex", "a"))).toBe("request-key");
  });
  it("times out a refresh and aborts the native request", async () => {
    let aborted = false;
    const { service } = await setup((_credential, signal) => new Promise<NativeOAuthCredential>((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
    }), undefined, account, undefined, 5);
    await expect(Effect.runPromise(service.resolve("openai-codex", "a"))).rejects.toBeInstanceOf(CredentialRefreshError);
    expect(aborted).toBe(true);
  });
  it("resolves non-expired credentials through async toAuth", async () => {
    const current = { ...account, credential: { ...account.credential, expires: 999_999 } };
    const refresh = vi.fn(async () => current.credential);
    const { service } = await setup(refresh, async () => ({ apiKey: "derived-key" }), current);
    expect(await Effect.runPromise(service.resolve("openai-codex", "a"))).toBe("derived-key");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("rejects a changed provider account id without persisting", async () => {
    const changed = { ...account.credential, expires: 999_999, accountId: "attacker" };
    const { service, saved } = await setup(async () => changed);
    await expect(Effect.runPromise(service.resolve("openai-codex", "a"))).rejects.toBeInstanceOf(CredentialRefreshError);
    expect(saved().credential).toEqual(account.credential);
  });
  it("preserves old credentials when refresh fails", async () => {
    const { service, saved } = await setup(async () => { throw new Error("private detail"); });
    await expect(Effect.runPromise(service.resolve("openai-codex", "a"))).rejects.toBeInstanceOf(CredentialRefreshError);
    expect(saved().credential).toEqual(account.credential);
  });
});
