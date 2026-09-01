import { Effect, Fiber } from "effect";
import type { Account, AccountsState, ProviderId } from "../domain.ts";
import type { AccountStoreApi } from "../services/account-store.ts";
import type { RuntimeAuthCoordinator } from "../services/runtime-auth.ts";
import type { SessionService } from "../services/session-service.ts";
import type { UsageService } from "../services/usage-service.ts";
import { runEffectAsPromise as run } from "../services/run-effect.ts";
import type { AccountProvider } from "../providers/provider.ts";
import { AccountsView, type AccountsViewAction } from "../ui/accounts-view.ts";
import { SecretInput } from "../ui/secret-input.ts";
import { sanitizeDisplay } from "../ui/account-row.ts";

interface AccountsCommandBinding {
  ctx: any;
  sessionId: string;
  session: SessionService;
  runtime: RuntimeAuthCoordinator;
  controllers: Set<AbortController>;
}

interface AccountsCommandDependencies {
  store: AccountStoreApi;
  providers: ReadonlyMap<ProviderId, AccountProvider<any, any>>;
  usage: UsageService;
  oauthInteraction?(ctx: any, signal: AbortSignal): Promise<any>;
}

interface CommandOptions {
  deps: AccountsCommandDependencies;
  getBinding: () => AccountsCommandBinding | undefined;
  isCurrent: (binding: AccountsCommandBinding) => boolean;
  broadcastUsage: (binding: AccountsCommandBinding) => void | Promise<void>;
}

const nameOf = (provider: ProviderId) => provider === "openai-codex" ? "OpenAI" : "OpenCode";

const notify = (ctx: any, message: string, level: "info" | "error" = "info") => {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
  }
};

/** Runs an Effect in a fiber and interrupts it when the AbortSignal fires. */
const runCancelable = async <A>(
  effect: Effect.Effect<A, unknown>,
  signal: AbortSignal,
): Promise<A> => {
  const fiber = Effect.runFork(effect);
  const interrupt = () => {
    void Effect.runPromise(Fiber.interrupt(fiber));
  };

  if (signal.aborted) {
    interrupt();
  } else {
    signal.addEventListener("abort", interrupt, { once: true });
  }

  try {
    return await Effect.runPromise(Fiber.join(fiber));
  } finally {
    signal.removeEventListener("abort", interrupt);
  }
};

const activeAccounts = (binding: AccountsCommandBinding) => ({
  "openai-codex": binding.runtime.activeAccount("openai-codex"),
  "opencode-go": binding.runtime.activeAccount("opencode-go"),
});

const persistSelection = async (
  binding: AccountsCommandBinding,
  provider: ProviderId,
  accountId: string,
  previousId?: string,
) => {
  try {
    binding.session.set(provider, accountId);
  } catch {
    if (previousId) {
      await run(binding.runtime.activate(provider, previousId));
    } else {
      await run(binding.runtime.clear(provider));
    }
    throw new Error("Account selection could not be saved");
  }
};

interface PreviousAccount {
  id?: string;
  account?: Account;
}

const findPreviousAccount = async (
  deps: AccountsCommandDependencies,
  binding: AccountsCommandBinding,
  provider: ProviderId,
): Promise<PreviousAccount> => {
  const id = binding.runtime.activeAccount(provider);
  if (!id) return {};
  const account = await run(deps.store.get(provider, id)).catch(() => undefined);
  return { id, account };
};

const accountLabel = (account: Pick<Account, "id" | "label">) => sanitizeDisplay(account.label || account.id);
const previousLabel = ({ id, account }: PreviousAccount) => accountLabel(account ?? { id: id || "current", label: "" });

const switchSuccessMessage = (account: Account, previous: PreviousAccount) => previous.account
  ? `Switched ${nameOf(account.provider)} account: ${accountLabel(previous.account)} → ${accountLabel(account)}`
  : `Activated ${nameOf(account.provider)} account: ${accountLabel(account)}`;

const switchFailureCategory = (error: unknown) => {
  const tag = (error as any)?._tag;
  return tag === "UsageAuthError" || tag === "CredentialRefreshError" ? "credentials rejected" : "unavailable";
};

const switchFailureNotice = (account: Account, previous: PreviousAccount, error: unknown, cancelled: boolean) => cancelled
  ? { message: `Switch cancelled — "${previousLabel(previous)}" stays active.`, level: "info" as const }
  : {
      message: `Could not switch to "${accountLabel(account)}" — "${previousLabel(previous)}" stays active. (${switchFailureCategory(error)})`,
      level: "error" as const,
    };

const switchAccount = async (
  options: CommandOptions,
  ctx: any,
  binding: AccountsCommandBinding,
  view: AccountsView,
  account: Account,
) => {
  const key = `${account.provider}/${account.id}`;
  const previous = await findPreviousAccount(options.deps, binding, account.provider);
  const abort = new AbortController();
  try {
    view.setBusyState(key, "Validating credentials…", true, () => abort.abort());
    await runCancelable(
      options.deps.providers.get(account.provider)!.validateAccount(account as never),
      abort.signal,
    );

    view.setBusyState(key, "Activating account…", false, null);
    await run(binding.runtime.switchAccount(account.provider, account.id));

    await persistSelection(binding, account.provider, account.id, previous.id);
    view.setActiveAccounts(activeAccounts(binding));
    notify(ctx, switchSuccessMessage(account, previous));
    void options.broadcastUsage(binding);
  } catch (error) {
    const notice = switchFailureNotice(account, previous, error, abort.signal.aborted);
    notify(ctx, notice.message, notice.level);
  } finally {
    view.setBusy(undefined);
  }
};

const presentAccounts = async (
  options: CommandOptions,
  ctx: any,
  binding: AccountsCommandBinding,
  accounts: Account[],
) => {
  let followUp: AccountsViewAction | undefined;
  await ctx.ui.custom(
    (tui: any, theme: any, kb: any, done: (action?: AccountsViewAction) => void) => {
      let view: AccountsView;
      view = new AccountsView({
        accounts,
        currentModel: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
        activeAccounts: activeAccounts(binding),
        usageFor: (account, force, signal) =>
          runCancelable(options.deps.usage.get(account, force), signal),
        requestRender: () => tui.requestRender(),
        theme,
        keybindings: kb,
        getRows: () => tui?.terminal?.rows ?? 30,
        onAction: (action) => {
          if (action.type === "switch") {
            return switchAccount(options, ctx, binding, view, action.account);
          }
          followUp = action;
          done(action);
        },
      });
      return view;
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "100%",
        maxHeight: "100%",
      },
    },
  );
  return followUp;
};

const removeAccount = async (
  deps: AccountsCommandDependencies,
  ctx: any,
  binding: AccountsCommandBinding,
  account: Account,
) => {
  if (!await ctx.ui.confirm("Remove account?", account.label || account.id)) {
    return false;
  }

  await run(deps.store.remove(account.provider, account.id));
  await run(deps.usage.invalidate(account.provider, account.id));

  if (binding.session.get(account.provider) === account.id) {
    binding.session.clear(account.provider);
  }
  if (binding.runtime.activeAccount(account.provider) === account.id) {
    await run(binding.runtime.invalidate(account.provider, account.id));
  }

  notify(ctx, `${nameOf(account.provider)} account removed.`);
  return true;
};

const chooseProvider = async (ctx: any): Promise<ProviderId | undefined> => {
  const choice = await ctx.ui.select("Provider", ["OpenAI Codex", "OpenCode Go"]);
  if (choice === "OpenAI Codex") return "openai-codex";
  if (choice === "OpenCode Go") return "opencode-go";
};

const accountIdentity = (before: AccountsState, provider: ProviderId, label: string) => {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "account";
  let id = base;
  let n = 2;

  while (Object.hasOwn(before.providers[provider].accounts, id)) {
    id = `${base}-${n++}`;
  }
  return id;
};

const createProviderAccount = async (
  deps: AccountsCommandDependencies,
  ctx: any,
  binding: AccountsCommandBinding,
  provider: ProviderId,
  id: string,
  label: string,
) => {
  if (provider === "opencode-go") {
    const key = await ctx.ui.custom(
      (tui: any, theme: any, _kb: any, done: (value?: string) => void) =>
        new SecretInput({
          prompt: "OpenCode API key: ",
          theme,
          requestRender: () => tui.requestRender(),
          onDone: (result) => done(result.type === "submit" ? result.value : undefined),
        }),
    );
    if (!key) {
      return;
    }
    return run(deps.providers.get(provider)!.createAccount({ id, label, key }));
  }
  if (!deps.oauthInteraction) {
    throw new Error();
  }
  const controller = new AbortController();
  binding.controllers.add(controller);
  try {
    const interaction = await deps.oauthInteraction(ctx, controller.signal);
    return await run(deps.providers.get(provider)!.createAccount({ id, label, interaction }));
  } finally {
    controller.abort();
    binding.controllers.delete(controller);
  }
};

const activateCreatedAccount = async (binding: AccountsCommandBinding, account: Account) => {
  const previous = binding.runtime.activeAccount(account.provider);
  await run(binding.runtime.activate(account.provider, account.id));
  await persistSelection(binding, account.provider, account.id, previous);
};

const addAccount = async (
  deps: AccountsCommandDependencies,
  ctx: any,
  binding: AccountsCommandBinding,
  before: AccountsState,
) => {
  const provider = await chooseProvider(ctx);
  if (!provider) {
    return;
  }

  const label = (await ctx.ui.input("Account label"))?.trim();
  if (!label) {
    return;
  }

  const account = await createProviderAccount(
    deps,
    ctx,
    binding,
    provider,
    accountIdentity(before, provider, label),
    label,
  );
  if (!account) {
    return;
  }

  if (!before.providers[provider].defaultAccount) {
    await run(deps.store.setDefault(provider, account.id));
  }
  if (provider === "openai-codex" && Object.hasOwn(before.providers[provider].accounts, account.id)) {
    notify(
      ctx,
      `This ChatGPT account is already saved as "${account.label}" — authentication was refreshed. To add another account, sign in to a different ChatGPT account or workspace in your browser.`,
    );
  }

  await activateCreatedAccount(binding, account);
  notify(ctx, `${nameOf(provider)} account added.`);
};

const processFollowUpAction = async (
  options: CommandOptions,
  ctx: any,
  binding: AccountsCommandBinding,
  action: Exclude<AccountsViewAction, { type: "close" }>,
) => {
  try {
    if (action.type === "remove") {
      if (!await removeAccount(options.deps, ctx, binding, action.account)) return;
    } else {
      await addAccount(
        options.deps,
        ctx,
        binding,
        await run(options.deps.store.load()),
      );
    }
  } catch {
    notify(
      ctx,
      "Accounts operation failed. Run /accounts to review saved accounts.",
      "error",
    );
  }
  void options.broadcastUsage(binding);
};

export const makeAccountsCommand = (options: CommandOptions) => async (_args: string, ctx: any) => {
  if (ctx.mode !== "tui") {
    notify(ctx, "Accounts requires the TUI.", "error");
    return;
  }

  await ctx.waitForIdle();
  const binding = options.getBinding();
  if (!binding || binding.sessionId !== ctx.sessionManager.getSessionId()) {
    notify(ctx, "Accounts session is unavailable.", "error");
    return;
  }

  while (options.isCurrent(binding)) {
    const accounts = await run(options.deps.store.list()).catch(() => [] as Account[]);
    const action = await presentAccounts(options, ctx, binding, [...accounts]);
    if (!action || action.type === "close") {
      return;
    }

    await processFollowUpAction(options, ctx, binding, action);
  }
};
