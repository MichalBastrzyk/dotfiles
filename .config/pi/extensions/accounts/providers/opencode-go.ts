import { Effect, Schema } from "effect";
import { UsagePayloadError, type OpenCodeAccount, type UsageWindow } from "../domain.ts";
import type { AccountStoreApi } from "../services/account-store.ts";
import { fetchJson, parsePayload } from "../services/usage-http.ts";
import type { AccountProvider, ClockApi, FetchApi } from "./provider.ts";

const Entry = Schema.Struct({ status: Schema.String, percent: Schema.Number, resetsAt: Schema.String });
const Payload = Schema.Struct({ usage: Schema.Struct({
  rolling: Schema.optional(Entry), weekly: Schema.optional(Entry), monthly: Schema.optional(Entry),
}) });
export interface OpenCodeProviderOptions { store: AccountStoreApi; fetch?: FetchApi; clock?: ClockApi }
export const makeOpenCodeProvider = ({ store, fetch: fetcher, clock = { now: Date.now } }: OpenCodeProviderOptions): AccountProvider<OpenCodeAccount, { id: string; label: string; key: string }> => {
  const getUsage = (account: OpenCodeAccount, key: string) => Effect.gen(function* () {
    const raw = yield* fetchJson("opencode-go", "https://opencode.ai/zen/go/v1/usage", key, fetcher);
    const data = yield* parsePayload("opencode-go", Payload, raw);
    const windows: Record<string, UsageWindow> = {};
    for (const name of ["rolling", "weekly", "monthly"] as const) {
      const item = data.usage[name];
      if (!item) continue;
      if (item.percent < 0 || item.percent > 100 || !Number.isFinite(Date.parse(item.resetsAt))) return yield* Effect.fail(new UsagePayloadError({ provider: "opencode-go", message: "Usage response had an invalid shape" }));
      windows[name] = { used: item.percent, limit: 100, resetsAt: Date.parse(item.resetsAt) };
    }
    return { accountId: account.id, provider: "opencode-go" as const, windows, updatedAt: clock.now() };
  });
  return {
    id: "opencode-go", name: "OpenCode Go", resolveCredential: (id) => Effect.map(store.get("opencode-go", id), (account) => (account as OpenCodeAccount).key), getUsage,
    createAccount: ({ id, label, key }) => Effect.gen(function* () {
      const now = clock.now();
      const candidate: OpenCodeAccount = { id, label, key, provider: "opencode-go", kind: "api-key", createdAt: now, updatedAt: now };
      yield* getUsage(candidate, key);
      return yield* store.upsert(candidate) as Effect.Effect<OpenCodeAccount, unknown>;
    }),
    validateAccount: (account) => Effect.asVoid(getUsage(account, account.key)),
  };
};
