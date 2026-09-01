import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makeOpenCodeProvider } from "../providers/opencode-go.ts";
import { UsagePayloadError, type OpenCodeAccount } from "../domain.ts";

const account: OpenCodeAccount = { id: "a", label: "test", key: "not-a-secret", provider: "opencode-go", kind: "api-key", createdAt: 0, updatedAt: 0 };
const store = { get: () => Effect.succeed(account), upsert: (a: OpenCodeAccount) => Effect.succeed(a) } as never;
const response = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));

describe("OpenCode usage", () => {
  it("keeps authoritative used percentages for every window", async () => {
    const resetsAt = "2030-01-01T00:00:00Z";
    const provider = makeOpenCodeProvider({ store, clock: { now: () => 1 }, fetch: () => response({ usage: {
      rolling: { status: "ok", percent: 80, resetsAt }, weekly: { status: "ok", percent: 50, resetsAt }, monthly: { status: "rate-limited", percent: 0, resetsAt },
    } }) });
    const usage = await Effect.runPromise(provider.getUsage(account, account.key));
    expect(Object.fromEntries(Object.entries(usage.windows).map(([k, v]) => [k, v.used]))).toEqual({ rolling: 80, weekly: 50, monthly: 0 });
  });
  it("accepts new status values and missing usage windows", async () => {
    const resetsAt = "2030-01-01T00:00:00Z";
    const provider = makeOpenCodeProvider({ store, fetch: () => response({ usage: {
      rolling: { status: "degraded", percent: 25, resetsAt },
    } }) });
    const usage = await Effect.runPromise(provider.getUsage(account, account.key));
    expect(Object.keys(usage.windows)).toEqual(["rolling"]);
    await expect(Effect.runPromise(provider.createAccount({ id: "new", label: "New", key: "valid" }))).resolves.toMatchObject({ id: "new" });
  });
  it.each([-1, 101])("rejects out-of-range used value %s", async (percent) => {
    const entry = { status: "ok", percent: 10, resetsAt: "2030-01-01" };
    const provider = makeOpenCodeProvider({ store, fetch: () => response({ usage: { rolling: { ...entry, percent }, weekly: entry, monthly: entry } }) });
    await expect(Effect.runPromise(provider.getUsage(account, account.key))).rejects.toBeInstanceOf(UsagePayloadError);
  });
  it("rejects malformed dates", async () => {
    const entry = { status: "ok", percent: 10, resetsAt: "bad" };
    const provider = makeOpenCodeProvider({ store, fetch: () => response({ usage: { rolling: entry, weekly: entry, monthly: entry } }) });
    await expect(Effect.runPromise(provider.getUsage(account, account.key))).rejects.toBeInstanceOf(UsagePayloadError);
  });
});
