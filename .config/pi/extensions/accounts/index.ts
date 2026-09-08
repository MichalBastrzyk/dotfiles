import { createAccountsExtension } from "./extension.ts";
import { runEffectAsPromise } from "./services/run-effect.ts";

export { createAccountsExtension } from "./extension.ts";

/** Pi composition root: construct production adapters and attach the extension. */
export default async function accounts(pi: any) {
  const [
    { builtinProviders },
    ai,
    { makeFileStore },
    { makeAccountStore },
    { makeCredentialService },
    { makeOpenAIProvider },
    { makeOpenCodeProvider },
    { makeCheaperInferenceProvider },
    { makeUsageService },
    oauthUi,
  ] = await Promise.all([
    import("@earendil-works/pi-ai/providers/all"),
    import("@earendil-works/pi-ai"),
    import("./storage/file-store.ts"),
    import("./services/account-store.ts"),
    import("./services/credential-service.ts"),
    import("./providers/openai-codex.ts"),
    import("./providers/opencode-go.ts"),
    import("./providers/cheaper-inference.ts"),
    import("./services/usage-service.ts"),
    import("./ui/oauth-login.ts"),
  ]);

  const files = makeFileStore();
  const store = makeAccountStore(files);
  const oauth = builtinProviders().find(
    (provider: any) => provider.id === "openai-codex",
  )?.auth?.oauth;

  if (!oauth) {
    throw new Error("Native OpenAI OAuth unavailable");
  }

  const credentials = makeCredentialService({
    store,
    oauth,
    locksDir: files.locks,
  });
  const openai = makeOpenAIProvider({
    store,
    oauth,
    resolveCredential: (id: string) => credentials.resolve("openai-codex", id),
  });
  const opencode = makeOpenCodeProvider({ store });
  const cheaperInference = makeCheaperInferenceProvider({ store });
  const providers = new Map<any, any>([
    [openai.id, openai],
    [opencode.id, opencode],
    [cheaperInference.id, cheaperInference],
  ]);
  const usage = await runEffectAsPromise(makeUsageService(providers));
  const { makeCheaperInferenceModelSync } = await import("./services/model-sync.ts");
  const { readModelCache } = await import("./storage/model-cache.ts");
  const modelSync = makeCheaperInferenceModelSync({
    pi,
    store,
    credentials,
    cacheRoot: files.root,
    initialModels: await readModelCache(files.root),
  });
  modelSync.register();
  const extension = createAccountsExtension({
    store,
    credentials,
    providers,
    usage,
    cleanupSessionResources: (ai as any).cleanupSessionResources,
    oauthInteraction: oauthUi.makeOAuthInteraction,
    syncCheaperInferenceModels: (accountId?: string) => {
      void modelSync.syncAccount(accountId);
    },
  });

  return extension(pi);
}
