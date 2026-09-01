import { describe, expect, it, vi } from "vitest";
import { Effect, Fiber } from "effect";
import { UsageAuthError, UsageHttpError, UsagePayloadError, type OpenCodeAccount } from "../domain.ts";
import { fetchJson, makeUsageService } from "../services/usage-service.ts";

const run = (fetcher: typeof fetch, options = {}) => Effect.runPromise(fetchJson("opencode-go", "https://invalid.test", "fake", fetcher, { retryBaseMs: 0, retryAfterMaxMs: 0, ...options }));
const account = (id = "a"): OpenCodeAccount => ({ id, label: id, key: "fake", provider: "opencode-go", kind: "api-key", createdAt: 0, updatedAt: 0 });

describe("safe usage fetch", () => {
  it("rejects malformed JSON", async () => await expect(run(async () => new Response("{"))).rejects.toBeInstanceOf(UsagePayloadError));
  it("does not retry authentication failures", async () => {
    const fetcher = vi.fn(async () => new Response("denied", { status: 401 }));
    await expect(run(fetcher)).rejects.toBeInstanceOf(UsageAuthError);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("classifies and cancels authentication failures before reading a large body", async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const fetcher = vi.fn(async () => new Response(body, { status: 401, headers: { "content-length": "5000" } }));
    await expect(run(fetcher)).rejects.toBeInstanceOf(UsageAuthError);
    expect(cancelled).toBe(true);
  });
  it("retries 429 exactly once for delta and HTTP-date Retry-After", async () => {
    for (const header of ["0", new Date(Date.now() - 1_000).toUTCString()]) {
      const fetcher = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": header } })).mockResolvedValueOnce(new Response("{}"));
      await expect(run(fetcher)).resolves.toEqual({});
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it("does not send exhausted 429 responses through the generic retry schedule", async () => {
    const fetcher = vi.fn(async () => new Response("busy", { status: 429 }));
    await expect(run(fetcher)).rejects.toMatchObject({ _tag: "UsageHttpError", status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("cancels large HTTP error bodies and keeps status classification", async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const fetcher = vi.fn(async () => new Response(body, { status: 503, headers: { "content-length": "5000" } }));
    await expect(run(fetcher, { networkRetries: 0 })).rejects.toBeInstanceOf(UsageHttpError);
    expect(cancelled).toBe(true);
  });
  it("times out and cancels the injected fetch signal", async () => {
    let aborted = false;
    const fetcher = (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }));
    await expect(run(fetcher as never, { timeoutMs: 5, networkRetries: 0 })).rejects.toThrow("timed out");
    expect(aborted).toBe(true);
  });
  it("cancels a streamed body immediately over the limit", async () => {
    let cancelled = false;
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(65 * 1024)); }, cancel() { cancelled = true; } });
    await expect(run(async () => new Response(body))).rejects.toBeInstanceOf(UsagePayloadError);
    expect(cancelled).toBe(true);
  });
  it("cancels a pending streamed body on timeout", async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    await expect(run(async () => new Response(body), { timeoutMs: 5, networkRetries: 0 })).rejects.toThrow("timed out");
    expect(cancelled).toBe(true);
  });
});

describe("usage cache", () => {
  it("supports TTL, force, every invalidate form, and single-flight", async () => {
    let now = 0, calls = 0;
    const provider = { id: "opencode-go" as const, name: "test", resolveCredential: () => Effect.succeed("fake"), getUsage: (a: OpenCodeAccount) => Effect.promise(async () => { calls++; await Promise.resolve(); return { accountId: a.id, provider: a.provider, windows: {}, updatedAt: now }; }) } as never;
    const service = await Effect.runPromise(makeUsageService(new Map([["opencode-go", provider]]), { now: () => now }));
    await Promise.all([1, 2, 3].map(() => Effect.runPromise(service.get(account())))); expect(calls).toBe(1);
    await Effect.runPromise(service.get(account())); expect(calls).toBe(1);
    await Effect.runPromise(service.get(account(), true)); expect(calls).toBe(2);
    await Effect.runPromise(service.invalidate("opencode-go", "a")); await Effect.runPromise(service.get(account())); expect(calls).toBe(3);
    await Effect.runPromise(service.invalidate(undefined, "a")); await Effect.runPromise(service.get(account())); expect(calls).toBe(4);
    await Effect.runPromise(service.invalidate("opencode-go")); await Effect.runPromise(service.get(account())); expect(calls).toBe(5);
    await Effect.runPromise(service.invalidate()); await Effect.runPromise(service.get(account())); expect(calls).toBe(6);
    now = 30_001; await Effect.runPromise(service.get(account())); expect(calls).toBe(7);
  });
  it("returns an expired cached value as stale when refresh is unavailable", async () => {
    let now = 0, fail = false;
    const provider = { id: "opencode-go" as const, name: "test", resolveCredential: () => Effect.succeed("fake"), getUsage: (a: OpenCodeAccount) => fail
      ? Effect.fail(new Error("offline"))
      : Effect.succeed({ accountId: a.id, provider: a.provider, windows: {}, updatedAt: now }) } as never;
    const service = await Effect.runPromise(makeUsageService(new Map([["opencode-go", provider]]), { now: () => now }));
    await Effect.runPromise(service.get(account()));
    now = 30_001; fail = true;
    await expect(Effect.runPromise(service.get(account()))).resolves.toMatchObject({ accountId: "a", state: "stale" });
  });
  it("removes an interrupted owner flight so the next get retries", async () => {
    let calls = 0;
    const provider = { id: "opencode-go" as const, name: "test", resolveCredential: () => Effect.succeed("fake"), getUsage: (a: OpenCodeAccount) => ++calls === 1
      ? Effect.never
      : Effect.succeed({ accountId: a.id, provider: a.provider, windows: {}, updatedAt: 0 }) } as never;
    const service = await Effect.runPromise(makeUsageService(new Map([["opencode-go", provider]])));
    const first = Effect.runFork(service.get(account()));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Effect.runPromise(Fiber.interrupt(first));
    await expect(Effect.runPromise(service.get(account()))).resolves.toMatchObject({ accountId: "a" });
    expect(calls).toBe(2);
  });
  it("limits all() concurrency to four and skips unavailable accounts", async () => {
    let active = 0, peak = 0;
    const provider = { id: "opencode-go" as const, name: "test", resolveCredential: () => Effect.succeed("fake"), getUsage: (a: OpenCodeAccount) => a.id === "bad"
      ? Effect.fail(new Error("offline"))
      : Effect.promise(async () => { peak = Math.max(peak, ++active); await new Promise((r) => setTimeout(r, 2)); active--; return { accountId: a.id, provider: a.provider, windows: {}, updatedAt: 0 }; }) } as never;
    const service = await Effect.runPromise(makeUsageService(new Map([["opencode-go", provider]])));
    const usages = await Effect.runPromise(service.all([...Array.from({ length: 9 }, (_, i) => account(String(i))), account("bad")]));
    expect(peak).toBe(4);
    expect(usages).toHaveLength(9);
  });
});
