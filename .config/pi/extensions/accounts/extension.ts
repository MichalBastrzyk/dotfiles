import type { ProviderId } from "./domain.ts";
import { isProviderId, PROVIDER_IDS, PROVIDERS } from "./providers/catalog.ts";
import type { AccountStoreApi } from "./services/account-store.ts";
import type { CredentialService } from "./services/credential-service.ts";
import { makeAccountSelectionPolicy } from "./services/selection-policy.ts";
import { makeSessionService, type SessionService } from "./services/session-service.ts";
import {
  makeRuntimeAuthCoordinator,
  type RuntimeAuthCoordinator,
} from "./services/runtime-auth.ts";
import type { UsageService } from "./services/usage-service.ts";
import { runEffectAsPromise as run } from "./services/run-effect.ts";
import type { AccountProvider } from "./providers/provider.ts";
import { sanitizeDisplay } from "./ui/account-row.ts";
import { ACCOUNTS_INFO_CHANNEL } from "../shared/dashboard-state.ts";
import { makeAccountsCommand } from "./commands/accounts-command.ts";

export interface AccountsDependencies {
  store: AccountStoreApi;
  credentials: CredentialService;
  providers: ReadonlyMap<ProviderId, AccountProvider<any, any>>;
  usage: UsageService;
  cleanupSessionResources?(sessionId: string): unknown | Promise<unknown>;
  oauthInteraction?(ctx: any, signal: AbortSignal): Promise<any>;
  syncCheaperInferenceModels?(accountId?: string): void;
}

type Binding = {
  ctx: any;
  sessionId: string;
  session: SessionService;
  runtime: RuntimeAuthCoordinator;
  controllers: Set<AbortController>;
  interval?: ReturnType<typeof setInterval>;
};

const providerOf = (value?: string): ProviderId | undefined =>
  isProviderId(value) ? value : undefined;
const nameOf = (provider: ProviderId) => PROVIDERS[provider].shortName;
const notify = (ctx: any, message: string, level: "info" | "error" = "info") => {
  if (ctx.hasUI) ctx.ui.notify(message, level);
};
export const createAccountsExtension = (deps: AccountsDependencies) => (pi: any) => {
  let binding: Binding | undefined;

  const releaseBinding = async (stale: Binding) => {
    if (stale.interval) clearInterval(stale.interval);
    for (const controller of stale.controllers) controller.abort();
    stale.controllers.clear();

    await Promise.allSettled([
      ...([...PROVIDER_IDS] as ProviderId[]).map((provider) =>
        run(stale.runtime.clear(provider)),
      ),
      Promise.resolve().then(() => deps.cleanupSessionResources?.(stale.sessionId)),
    ]);
  };

  const activateFor = async (current: Binding, provider: ProviderId) => {
    const active = current.runtime.activeAccount(provider);
    let data;

    try {
      data = await run(deps.store.load());
    } catch {
      await run(
        current.runtime.invalidate(provider, current.session.get(provider) ?? active ?? "unknown"),
      );
      return;
    }

    const id = makeAccountSelectionPolicy(current.session, data).select(provider);
    if (!id) {
      if (active) await run(current.runtime.invalidate(provider, active));
      return;
    }

    try {
      await run(deps.store.get(provider, id));
      await run(current.runtime.ensureActive(provider, id));
      if (provider === "cheaper-inference") deps.syncCheaperInferenceModels?.(id);
    } catch {
      await run(current.runtime.invalidate(provider, id));
    }
  };

  const broadcastUsage = async (current: Binding) => {
    try {
      const accounts = await run(deps.store.list());
      const usages = await run(deps.usage.all(accounts));
      const byAccount = new Map(usages.map((usage) => [`${usage.provider}/${usage.accountId}`, usage]));
      const currentProvider = providerOf(current.ctx.model?.provider);
      const infos = [];

      for (const account of accounts) {
        const usage = byAccount.get(`${account.provider}/${account.id}`);
        if (!usage) continue;

        const windows = Object.entries(usage.windows).map(([id, window]) => ({
          id,
          remaining: Math.round(
            window.limit > 0
              ? Math.max(0, Math.min(100, 100 - (window.used / window.limit) * 100))
              : 0,
          ),
          resetsAt: window.resetsAt ?? null,
        }));
        infos.push({
          provider: account.provider,
          accountId: account.id,
          label: account.label || account.id,
          active:
            currentProvider === account.provider &&
            current.runtime.activeAccount(account.provider) === account.id,
          plan: usage.plan ?? null,
          windows,
          summary: usage.summary ?? null,
        });
      }

      if (binding === current) pi.events.emit(ACCOUNTS_INFO_CHANNEL, infos);
    } catch {
      // Keep the last footer state.
    }
  };

  const activateSafely = async (current: Binding, provider: ProviderId) => {
    try {
      await activateFor(current, provider);
    } catch {
      // turn_start fails closed.
    }
    void broadcastUsage(current);
  };

  pi.registerCommand("accounts", {
    description: "Manage provider accounts",
    handler: makeAccountsCommand({
      deps,
      getBinding: () => binding,
      isCurrent: (candidate) => binding === candidate,
      broadcastUsage,
      syncCheaperInferenceModels: (accountId) => deps.syncCheaperInferenceModels?.(accountId),
    }),
  });

  pi.on("session_start", async (event: any, ctx: any) => {
    const stale = binding;
    binding = undefined;
    if (stale) await releaseBinding(stale);

    const session = makeSessionService(ctx.sessionManager);
    if (event.reason === "fork") {
      for (const provider of [...PROVIDER_IDS] as ProviderId[]) {
        if (session.get(provider)) session.clear(provider);
      }
    }

    const runtime = makeRuntimeAuthCoordinator({
      ctx,
      credentials: deps.credentials,
      cleanupSessionResources: deps.cleanupSessionResources,
    });
    const created: Binding = {
      ctx,
      sessionId: ctx.sessionManager.getSessionId(),
      session,
      runtime,
      controllers: new Set(),
    };

    binding = created;
    created.interval = setInterval(() => void broadcastUsage(created), 29_000);

    // Activate the current model provider plus CheaperInference in the
    // background: /model lists only auth-configured providers, and CI has
    // no Pi-level auth besides the runtime key, so without this its models
    // stay invisible while another provider's model is active. Keys are
    // per-provider, so this cannot shadow OpenAI/OpenCode auth.
    const provider = providerOf(ctx.model?.provider);
    const providersToActivate = new Set<ProviderId>(["cheaper-inference"]);
    if (provider) providersToActivate.add(provider);
    for (const candidate of providersToActivate) {
      try {
        await activateFor(created, candidate);
      } catch {
        // before_agent_start will fail closed.
      }
    }
    void broadcastUsage(created);
  });

  pi.on("model_select", async (event: any) => {
    const current = binding;
    const provider = providerOf(event.model?.provider);
    if (current && provider) await activateSafely(current, provider);
  });

  pi.on("before_agent_start", async (_event: any, ctx: any) => {
    const current = binding;
    const provider = providerOf(ctx.model?.provider);
    if (current && provider) await activateSafely(current, provider);
  });

  pi.on("turn_start", (_event: any, ctx: any) => {
    const current = binding;
    const provider = providerOf(ctx.model?.provider);
    if (!current || !provider || !current.runtime.isBlocked(provider)) return;

    ctx.abort();
    void run(deps.store.load())
      .then((data) => {
        const id =
          makeAccountSelectionPolicy(current.session, data).select(provider) ??
          current.runtime.activeAccount(provider) ??
          "unknown";
        return run(deps.store.get(provider, id))
          .catch(() => undefined)
          .then((account) => {
            const label = sanitizeDisplay(account?.label || account?.id || id);
            notify(ctx, `${nameOf(provider)} account "${label}" needs authentication. Run /accounts.`, "error");
          });
      })
      .catch(() => {
        notify(ctx, `${nameOf(provider)} account needs authentication. Run /accounts.`, "error");
      });
  });

  pi.on("session_shutdown", async () => {
    const current = binding;
    binding = undefined;
    if (current) await releaseBinding(current);
  });
};
