import { Effect } from "effect";
import type { AccountStoreApi } from "../services/account-store.ts";
import type { OpenAIAccount } from "../domain.ts";
import { fetchJson, parsePayload } from "../services/usage-http.ts";
import { normalizeOpenAIUsage, OpenAIUsagePayload } from "./openai-usage.ts";
import type { AccountProvider, ClockApi, FetchApi } from "./provider.ts";

export interface NativeOAuthCredential {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  [key: string]: unknown;
}
export type NativeAuthPrompt = { signal?: AbortSignal } & (
  | { type: "text"; message: string; placeholder?: string }
  | { type: "secret"; message: string; placeholder?: string }
  | { type: "manual_code"; message: string; placeholder?: string }
  | { type: "select"; message: string; options: readonly { id: string; label: string; description?: string }[] }
);
export type NativeAuthEvent =
  | { type: "info"; message: string; links?: readonly { url: string; label?: string }[] }
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
  | { type: "progress"; message: string };
export interface NativeProviderAuthInteraction {
  signal: AbortSignal;
  prompt: (prompt: NativeAuthPrompt) => Promise<string>;
  notify: (event: NativeAuthEvent) => void;
}
export interface NativeModelAuth { apiKey?: string; headers?: Readonly<Record<string, string | null>> }
/** Structural type of Pi's maintained OAuth provider; Pi itself is not imported. */
export interface NativeOpenAIOAuth {
  login: (interaction: NativeProviderAuthInteraction) => Promise<NativeOAuthCredential>;
  refresh: (credential: NativeOAuthCredential, signal: AbortSignal) => Promise<NativeOAuthCredential>;
  toAuth: (credential: NativeOAuthCredential) => Promise<NativeModelAuth>;
}

export const validOAuthCredential = (value: NativeOAuthCredential): boolean =>
  value?.type === "oauth" && typeof value.access === "string" && value.access.length > 0
  && typeof value.refresh === "string" && value.refresh.length > 0
  && typeof value.expires === "number" && Number.isFinite(value.expires);
export const validApiKey = (value?: string): value is string => typeof value === "string" && value.length > 0;
export interface OpenAIProviderOptions { store: AccountStoreApi; oauth: NativeOpenAIOAuth; resolveCredential: (id: string) => Effect.Effect<string, unknown>; fetch?: FetchApi; clock?: ClockApi }
export interface OpenAIAccountInput { id: string; label: string; interaction: NativeProviderAuthInteraction }
export const makeOpenAIProvider = ({ store, oauth, resolveCredential, fetch: fetcher, clock = { now: Date.now } }: OpenAIProviderOptions): AccountProvider<OpenAIAccount, OpenAIAccountInput> => ({
  id: "openai-codex", name: "OpenAI Codex", resolveCredential,
  createAccount: ({ id, label, interaction }) => Effect.gen(function* () {
    const credential = yield* Effect.tryPromise({ try: () => oauth.login(interaction), catch: () => new Error("OpenAI login failed") });
    if (!validOAuthCredential(credential) || typeof credential.accountId !== "string" || credential.accountId.length === 0)
      return yield* Effect.fail(new Error("OpenAI login returned invalid credentials"));
    const auth = yield* Effect.tryPromise({ try: () => oauth.toAuth(credential), catch: () => new Error("OpenAI login returned unusable credentials") });
    if (!validApiKey(auth.apiKey)) return yield* Effect.fail(new Error("OpenAI login returned unusable credentials"));
    const now = clock.now();
    const stored = yield* store.upsert({ id, label, provider: "openai-codex", kind: "oauth", credential: { type: "oauth", access: credential.access, refresh: credential.refresh, expires: credential.expires, accountId: credential.accountId }, createdAt: now, updatedAt: now });
    if (stored.provider !== "openai-codex") return yield* Effect.fail(new Error("OpenAI account could not be stored"));
    return stored;
  }),
  getUsage: (account, credential) => Effect.gen(function* () {
    const payload = yield* fetchJson("openai-codex", "https://chatgpt.com/backend-api/wham/usage", credential, fetcher);
    const data = yield* parsePayload("openai-codex", OpenAIUsagePayload, payload);
    return normalizeOpenAIUsage(data, account.id, clock.now());
  }),
  validateAccount: (account) => Effect.asVoid(Effect.flatMap(resolveCredential(account.id), (credential) =>
    Effect.catch(
      fetchJson("openai-codex", "https://chatgpt.com/backend-api/wham/usage", credential, fetcher),
      (error) => error._tag === "UsageHttpError" && error.retryable ? Effect.void : Effect.fail(error),
    ))),
});
