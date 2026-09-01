import { Effect } from "effect";
import type { ProviderId } from "../domain.ts";
import type { CredentialService } from "./credential-service.ts";

const FAILED_KEY = "pi-accounts-auth-failed";

type RuntimeKeys = {
  setRuntimeApiKey(provider: string, key: string): unknown;
  removeRuntimeApiKey(provider: string): unknown;
};
type ActivationSnapshot = {
  previousKey: string | undefined;
  previousAccount: string | undefined;
  wasTouched: boolean;
};
export interface ModelRegistryLike {
  runtime?: Partial<RuntimeKeys>;
  authStorage?: Partial<RuntimeKeys>;
  getApiKeyForProvider(provider: string): string | undefined | Promise<string | undefined>;
  getRegisteredProviderConfig?(provider: string): Record<string, unknown> | undefined;
  unregisterProvider?(provider: string): unknown;
  registerProvider?(provider: string, config: Record<string, unknown>): unknown;
}
export interface RuntimeAuthContext {
  modelRegistry: ModelRegistryLike;
  model: { provider: string; id: string };
  sessionManager?: { getSessionId(): string };
}
export class RuntimeActivationError extends Error {
  readonly name = "RuntimeActivationError";
  declare readonly cause: unknown;
  constructor(
    readonly provider: ProviderId,
    readonly accountId: string,
    message = "Account activation failed",
    cause?: unknown,
  ) {
    super(message);
    Object.defineProperty(this, "cause", {
      value: cause,
      enumerable: false,
    });
  }
}
export interface RuntimeAuthOptions {
  ctx: RuntimeAuthContext;
  credentials: CredentialService;
  validate?: (provider: ProviderId, accountId: string, credential: string) => Effect.Effect<void, unknown>;
  cleanupSessionResources?: (sessionId: string) => unknown | Promise<unknown>;
}

export const makeRuntimeAuthCoordinator = ({ ctx, credentials, validate, cleanupSessionResources }: RuntimeAuthOptions) => {
  const registry = ctx.modelRegistry;
  const keys = [registry.runtime, registry.authStorage].find(
    (candidate): candidate is RuntimeKeys =>
      typeof candidate?.setRuntimeApiKey === "function" &&
      typeof candidate.removeRuntimeApiKey === "function",
  );
  if (!keys) {
    throw new Error("Pi runtime API key override is unavailable");
  }
  const active = new Map<ProviderId, string>();
  const blocked = new Map<ProviderId, RuntimeActivationError>();
  const ownedKeys = new Map<ProviderId, string>();
  const touched = new Set<ProviderId>();
  const pristine = new Map<ProviderId, Record<string, unknown> | undefined>();
  const tails = new Map<ProviderId, Promise<void>>();
  const serialized = <A>(provider: ProviderId, work: () => Promise<A>) => {
    const previous = tails.get(provider) ?? Promise.resolve();
    const result = previous.then(work, work);
    tails.set(
      provider,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  };
  const snapshotPristine = (provider: ProviderId) => {
    if (provider === "openai-codex" && !pristine.has(provider)) {
      pristine.set(provider, registry.getRegisteredProviderConfig?.(provider));
    }
  };
  // getRegisteredProviderConfig() only snapshots extension overlays; undefined still
  // has a builtin provider underneath, so an apiKey-only overlay is both valid and required.
  const replaceOpenAI = async (config?: Record<string, unknown>) => {
    await registry.unregisterProvider?.("openai-codex");
    if (config) await registry.registerProvider?.("openai-codex", config);
  };
  const configForKey = (key: string) => ({ ...(pristine.get("openai-codex") ?? {}), apiKey: key });
  const resolveAndValidate = async (provider: ProviderId, accountId: string) => {
    try {
      const key = await Effect.runPromise(credentials.resolve(provider, accountId));
      if (validate) {
        await Effect.runPromise(validate(provider, accountId, key));
      }
      return key;
    } catch (cause) {
      throw new RuntimeActivationError(provider, accountId, "Account credential could not be resolved", cause);
    }
  };
  const activationSnapshot = (provider: ProviderId): ActivationSnapshot => {
    snapshotPristine(provider);
    return {
      previousKey: ownedKeys.get(provider),
      previousAccount: active.get(provider),
      wasTouched: touched.has(provider),
    };
  };
  const installAndVerify = async (provider: ProviderId, key: string) => {
    if (provider === "openai-codex") {
      await replaceOpenAI(configForKey(key));
    }
    await keys.setRuntimeApiKey(provider, key);
    touched.add(provider);
    ownedKeys.set(provider, key);
    if ((await registry.getApiKeyForProvider(provider)) !== key) {
      throw new Error("Runtime credential verification failed");
    }
  };
  const rollbackSnapshot = async (provider: ProviderId, snapshot: ActivationSnapshot) => {
    try {
      if (snapshot.previousKey === undefined) {
        await keys.removeRuntimeApiKey(provider);
        ownedKeys.delete(provider);
      } else {
        await keys.setRuntimeApiKey(provider, snapshot.previousKey);
        ownedKeys.set(provider, snapshot.previousKey);
      }

      if (provider === "openai-codex") {
        await replaceOpenAI(
          snapshot.previousKey === undefined
            ? pristine.get(provider)
            : configForKey(snapshot.previousKey),
        );
      }
    } catch {
      /* preserve the original safe error */
    }

    if (snapshot.previousAccount === undefined) {
      active.delete(provider);
    } else {
      active.set(provider, snapshot.previousAccount);
    }
    if (!snapshot.wasTouched) {
      touched.delete(provider);
    }
  };
  const commitState = (provider: ProviderId, accountId: string) => {
    active.set(provider, accountId);
    blocked.delete(provider);
  };
  const cleanupIdentityChange = async (provider: ProviderId, accountId: string, previousAccount: string | undefined) => {
    if (
      provider !== "openai-codex" ||
      previousAccount === undefined ||
      previousAccount === accountId
    ) {
      return;
    }

    const sessionId = ctx.sessionManager?.getSessionId();
    if (sessionId) {
      try {
        await cleanupSessionResources?.(sessionId);
      } catch {
        /* stale resources are retried during binding release */
      }
    }
  };
  const runActivation = async (provider: ProviderId, accountId: string) => {
    const key = await resolveAndValidate(provider, accountId);
    const snapshot = activationSnapshot(provider);
    try {
      await installAndVerify(provider, key);
      commitState(provider, accountId);
    } catch (cause) {
      await rollbackSnapshot(provider, snapshot);
      throw new RuntimeActivationError(provider, accountId, "Account activation failed", cause);
    }
    await cleanupIdentityChange(provider, accountId, snapshot.previousAccount);
  };

  const activate = (provider: ProviderId, accountId: string) =>
    Effect.tryPromise({
      try: () => serialized(provider, () => runActivation(provider, accountId)),
      catch: (error) =>
        error instanceof RuntimeActivationError
          ? error
          : new RuntimeActivationError(
              provider,
              accountId,
              "Account activation failed",
              error,
            ),
    });

  const invalidate = (
    provider: ProviderId,
    accountId = active.get(provider) ?? "unknown",
    cause?: unknown,
  ) =>
    Effect.tryPromise({
      try: () =>
        serialized(provider, async () => {
          const error = new RuntimeActivationError(
            provider,
            accountId,
            "Selected account is unavailable",
            cause,
          );
          snapshotPristine(provider);
          active.delete(provider);
          blocked.set(provider, error);
          if (provider === "openai-codex") {
            await replaceOpenAI(pristine.get(provider));
          }
          await keys.setRuntimeApiKey(provider, FAILED_KEY);
          touched.add(provider);
          ownedKeys.set(provider, FAILED_KEY);
        }),
      catch: (error) => error,
    });

  const ensureActive = (provider: ProviderId, accountId: string) =>
    Effect.catch(activate(provider, accountId), (error) =>
      Effect.flatMap(invalidate(provider, accountId, error), () => Effect.fail(error)),
    );

  const clear = (provider: ProviderId) =>
    Effect.tryPromise({
      try: () =>
        serialized(provider, async () => {
          if (!touched.has(provider)) return;

          await keys.removeRuntimeApiKey(provider);
          if (provider === "openai-codex") {
            await replaceOpenAI(pristine.get(provider));
          }
          active.delete(provider);
          blocked.delete(provider);
          ownedKeys.delete(provider);
          pristine.delete(provider);
          touched.delete(provider);
        }),
      catch: (error) => error,
    });

  return {
    activate,
    switchAccount: activate,
    ensureActive,
    invalidate,
    clear,
    isBlocked: (provider: ProviderId) => blocked.has(provider),
    error: (provider: ProviderId) => blocked.get(provider),
    activeAccount: (provider: ProviderId) => active.get(provider),
  };
};
export type RuntimeAuthCoordinator = ReturnType<typeof makeRuntimeAuthCoordinator>;
