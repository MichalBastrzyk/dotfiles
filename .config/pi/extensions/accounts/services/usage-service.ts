import { Deferred, Effect, Ref } from "effect";
import { UsageProviderError, type Account, type AccountUsage, type ProviderId } from "../domain.ts";
import type { AccountProvider, ClockApi } from "../providers/provider.ts";

export { fetchJson, parsePayload, readBounded, retryAfter, type FetchJsonOptions } from "./usage-http.ts";

interface Cached { readonly expires: number; readonly usage: AccountUsage }
export interface UsageService {
  get: (account: Account, force?: boolean) => Effect.Effect<AccountUsage, unknown>;
  invalidate: (provider?: ProviderId, accountId?: string) => Effect.Effect<void>;
  all: (accounts: ReadonlyArray<Account>, force?: boolean) => Effect.Effect<ReadonlyArray<AccountUsage>, unknown>;
}
export const makeUsageService = (providers: ReadonlyMap<ProviderId, AccountProvider<any, any>>, clock: ClockApi = { now: Date.now }) => Effect.gen(function* () {
  const cache = yield* Ref.make(new Map<string, Cached>());
  const flights = yield* Ref.make(new Map<string, Deferred.Deferred<AccountUsage, unknown>>());
  const key = (a: Account) => `${a.provider}/${a.id}`;
  const get = (account: Account, force = false): Effect.Effect<AccountUsage, unknown> => Effect.gen(function* () {
    const id = key(account);
    const hit = (yield* Ref.get(cache)).get(id);
    if (!force && hit && hit.expires > clock.now()) return hit.usage;
    const deferred = yield* Deferred.make<AccountUsage, unknown>();
    const selected: { deferred: Deferred.Deferred<AccountUsage, unknown>; owner: boolean } = yield* Ref.modify(flights, (all) => {
      const existing = all.get(id);
      return existing
        ? [{ deferred: existing, owner: false }, all]
        : [{ deferred, owner: true }, new Map(all).set(id, deferred)];
    });
    if (!selected.owner) return yield* Deferred.await(selected.deferred);
    const fetchUsage = Effect.gen(function* () {
      const provider = providers.get(account.provider);
      if (!provider) return yield* Effect.fail(new UsageProviderError({ provider: account.provider, message: "Usage provider is not configured" }));
      const credential = yield* provider.resolveCredential(account.id);
      const usage: AccountUsage = { ...(yield* provider.getUsage(account, credential)), state: "fresh" };
      yield* Ref.update(cache, (old) => new Map(old).set(id, { usage, expires: clock.now() + 30_000 }));
      return usage;
    });
    const work = hit
      ? Effect.catch(fetchUsage, () => Effect.succeed({ ...hit.usage, state: "stale" as const }))
      : fetchUsage;
    return yield* Effect.onExit(work, (exit) => Effect.flatMap(
      Deferred.done(deferred, exit),
      () => Ref.update(flights, (all) => { const next = new Map(all); next.delete(id); return next; }),
    ));
  });
  const service: UsageService = {
    get,
    invalidate: (provider?: ProviderId, accountId?: string) => Ref.update(cache, (old) => new Map([...old].filter(([id]) => {
      if (provider && accountId) return id !== `${provider}/${accountId}`;
      if (provider) return !id.startsWith(`${provider}/`);
      if (accountId) return !id.endsWith(`/${accountId}`);
      return false;
    }))),
    all: (accounts: ReadonlyArray<Account>, force?: boolean) => Effect.map(
      Effect.forEach(accounts, (account) => Effect.catch(get(account, force), () => Effect.succeed(undefined)), { concurrency: 4 }),
      (usages) => usages.filter((usage): usage is AccountUsage => usage !== undefined),
    ),
  };
  return service;
});
