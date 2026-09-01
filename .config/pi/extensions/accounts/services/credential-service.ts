import { Effect } from "effect";
import { AccountNotFoundError, CredentialRefreshError, type OpenAIAccount, type ProviderId } from "../domain.ts";
import { validApiKey, validOAuthCredential, type NativeOpenAIOAuth, type NativeOAuthCredential } from "../providers/openai-codex.ts";
import type { ClockApi } from "../providers/provider.ts";
import type { AccountStoreApi } from "./account-store.ts";
import { withLock } from "../storage/lock.ts";

export interface CredentialService { resolve: (provider: ProviderId, accountId: string) => Effect.Effect<string, unknown> }
export interface CredentialServiceOptions { store: AccountStoreApi; oauth: NativeOpenAIOAuth; locksDir: string; clock?: ClockApi; refreshTimeoutMs?: number }

export const makeCredentialService = ({ store, oauth, locksDir, clock = { now: Date.now }, refreshTimeoutMs = 30_000 }: CredentialServiceOptions): CredentialService => {
  const current = (id: string) => Effect.flatMap(store.get("openai-codex", id), (account) => account.provider === "openai-codex"
    ? Effect.succeed(account)
    : Effect.fail(new AccountNotFoundError({ provider: "openai-codex", accountId: id, message: "Account was not found" })));
  const requestKey = (credential: NativeOAuthCredential, id: string) => Effect.gen(function* () {
    const auth = yield* Effect.tryPromise({
      try: () => oauth.toAuth(credential),
      catch: () => new CredentialRefreshError({ provider: "openai-codex", accountId: id, message: "Credential could not be resolved" }),
    });
    return validApiKey(auth.apiKey)
      ? auth.apiKey
      : yield* Effect.fail(new CredentialRefreshError({ provider: "openai-codex", accountId: id, message: "Credential could not be resolved" }));
  });
  const resolveOpenAI = (id: string) => Effect.flatMap(current(id), (account) => {
    if (account.credential.expires > clock.now() + 300_000) return requestKey(account.credential, account.id);
    return withLock(locksDir, `credential-openai-codex-${account.id}`, Effect.gen(function* () {
      const latest = yield* current(account.id);
      if (latest.credential.expires > clock.now() + 300_000) return yield* requestKey(latest.credential, latest.id);
      const rotated = yield* Effect.tryPromise({
        try: (signal) => oauth.refresh(latest.credential, signal),
        catch: () => new CredentialRefreshError({ provider: "openai-codex", accountId: latest.id, message: "Credential refresh failed" }),
      }).pipe(Effect.timeoutOrElse({
        duration: refreshTimeoutMs,
        orElse: () => Effect.fail(new CredentialRefreshError({ provider: "openai-codex", accountId: latest.id, message: "Credential refresh timed out" })),
      }));
      if (!validOAuthCredential(rotated) || (rotated.accountId !== undefined && (rotated.accountId.length === 0 || rotated.accountId !== latest.credential.accountId)))
        return yield* Effect.fail(new CredentialRefreshError({ provider: "openai-codex", accountId: latest.id, message: "Credential refresh returned invalid credentials" }));
      const credential: OpenAIAccount["credential"] = {
        type: "oauth",
        access: rotated.access,
        refresh: rotated.refresh,
        expires: rotated.expires,
        accountId: rotated.accountId ?? latest.credential.accountId,
      };
      yield* store.updateCredential("openai-codex", latest.id, credential);
      return yield* requestKey(credential, latest.id);
    }));
  });
  return { resolve: (provider, id) => provider === "openai-codex" ? resolveOpenAI(id) : Effect.flatMap(store.get(provider, id), (account) =>
    account.provider === "opencode-go"
      ? Effect.succeed(account.key)
      : Effect.fail(new AccountNotFoundError({ provider, accountId: id, message: "Account was not found" }))) };
};
