import { Effect } from "effect";
import { writeModelCache } from "../storage/model-cache.ts";
import { CHEAPER_INFERENCE_BASE_URL } from "../providers/cheaper-inference.ts";
import {
  credentialKeyOf,
  fetchCheaperInferenceModels,
  type CheaperInferencePiModel,
} from "../providers/cheaper-inference-models.ts";
import type { AccountStoreApi } from "./account-store.ts";
import type { CredentialService } from "./credential-service.ts";

export interface CheaperInferenceModelSync {
  register: () => void;
  /**
   * Publish the live catalog. With an explicit account id it always
   * refetches (login/switch must show the new key's catalog); without an
   * id it syncs the default account, throttled, for session startup so the
   * list exists even before any CI account is activated.
   */
  syncAccount: (accountId?: string) => Promise<void>;
  refresh: (context: {
    credential?: unknown;
    signal: AbortSignal;
    allowNetwork?: boolean;
  }) => Promise<CheaperInferencePiModel[]>;
}

interface ModelSyncOptions {
  pi: any;
  store: AccountStoreApi;
  credentials: CredentialService;
  fetch?: typeof fetch;
  now?: () => number;
  cacheRoot?: string;
  initialModels?: CheaperInferencePiModel[];
}

interface RefreshContext {
  credential?: unknown;
  signal: AbortSignal;
  allowNetwork?: boolean;
}

/**
 * Owns the dynamic `cheaper-inference/*` model list.
 *
 * No `apiKey` is configured on purpose: /accounts is the sole owner of
 * CheaperInference auth via `setRuntimeApiKey()`. An unresolved `$ENV`
 * fallback must NOT be used here — Pi's refresh resolves it with
 * `resolveConfigValueOrThrow`, which throws on a missing env var and
 * surfaces as "Could not refresh cheaper-inference" in /model.
 *
 * Pi's refresh credential comes from its own credential store (auth.json),
 * which /accounts never writes to, so the refresh falls back to the
 * accounts store (default account, then first account) to keep the catalog
 * live. With no account anywhere it returns [] silently.
 */
const DEFAULT_SYNC_THROTTLE_MS = 5 * 60 * 1000;

export const makeCheaperInferenceModelSync = ({
  pi,
  store,
  credentials,
  fetch: fetcher = fetch,
  now = Date.now,
  cacheRoot,
  initialModels = [],
}: ModelSyncOptions): CheaperInferenceModelSync => {
  // Last successfully published list. Pi runs every refresh in two phases:
  // cache-only first, network second. Republishing the last-known list in
  // the cache-only phase (and when offline) keeps /model showing cached
  // models instead of wiping them when the network fetch cannot run.
  let lastModels: CheaperInferencePiModel[] = [...initialModels];
  let lastDefaultSync = 0;
  const remember = async (models: CheaperInferencePiModel[]) => {
    lastModels = models;
    if (cacheRoot) await writeModelCache(cacheRoot, models);
  };
  const baseConfig = () => ({
    name: "CheaperInference",
    baseUrl: CHEAPER_INFERENCE_BASE_URL,
    api: "openai-completions" as const,
    authHeader: true,
  });

  const defaultAccountId = async (): Promise<string | undefined> => {
    try {
      const state = await Effect.runPromise(store.load());
      const group = state.providers["cheaper-inference"];
      return group.defaultAccount ?? Object.keys(group.accounts)[0];
    } catch {
      return undefined;
    }
  };

  const accountsKey = async (): Promise<string | undefined> => {
    const id = await defaultAccountId();
    if (!id) return undefined;
    try {
      return await Effect.runPromise(credentials.resolve("cheaper-inference", id));
    } catch {
      return undefined;
    }
  };

  const refresh = async (context: RefreshContext): Promise<CheaperInferencePiModel[]> => {
    if (context.allowNetwork === false) return lastModels;
    const key = credentialKeyOf(context.credential) ?? (await accountsKey());
    if (!key) return lastModels;
    const models = await fetchCheaperInferenceModels({ key, fetcher, signal: context.signal });
    await remember(models);
    return models;
  };

  const register = () => {
    pi.registerProvider("cheaper-inference", {
      ...baseConfig(),
      models: lastModels,
      refreshModels: refresh,
    });
  };

  const publish = async (models: CheaperInferencePiModel[]) => {
    await remember(models);
    pi.registerProvider("cheaper-inference", { ...baseConfig(), models });
  };

  const syncAccount = async (accountId?: string): Promise<void> => {
    if (accountId === undefined) {
      if (now() - lastDefaultSync < DEFAULT_SYNC_THROTTLE_MS) return;
      lastDefaultSync = now();
      const id = await defaultAccountId();
      if (!id) return;
      await syncAccount(id);
      return;
    }
    let key: string;
    try {
      key = await Effect.runPromise(credentials.resolve("cheaper-inference", accountId));
    } catch {
      return;
    }
    try {
      await publish(await fetchCheaperInferenceModels({ key, fetcher }));
    } catch {
      // Keep the previous list on offline/auth failures.
    }
  };

  return { register, syncAccount, refresh };
};
