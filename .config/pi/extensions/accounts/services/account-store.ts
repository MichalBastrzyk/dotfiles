import { Effect } from "effect";
import { AccountNotFoundError, InvalidAccountError, type Account, type AccountsState, type OpenAIAccount, type ProviderId } from "../domain.ts";
import { makeFileStore, type FileStore } from "../storage/file-store.ts";
import { withLock } from "../storage/lock.ts";
import { openAIIdentity } from "./openai-identity.ts";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const checkId = (id: string) => {
  const value = id.trim();
  if (!ID.test(value)) throw new InvalidAccountError({ message: "Account id is invalid" });
  return value;
};
const normalizeId = (id: string) => checkId(id).toLowerCase();
const checkLabel = (label: string) => {
  const value = label.trim();
  if (!value || Array.from(value).length > 128 || CONTROL.test(value))
    throw new InvalidAccountError({ message: "Account label is invalid" });
  return value;
};
const availableId = (requested: string, accounts: Readonly<Record<string, unknown>>) => {
  if (!Object.hasOwn(accounts, requested)) return requested;
  let suffix = 2;
  while (Object.hasOwn(accounts, `${requested}-${suffix}`)) suffix++;
  return `${requested}-${suffix}`;
};

export interface AccountStoreApi {
  load: () => Effect.Effect<AccountsState, unknown>;
  list: (provider?: ProviderId) => Effect.Effect<ReadonlyArray<Account>, unknown>;
  get: (provider: ProviderId, id: string) => Effect.Effect<Account, unknown>;
  upsert: (account: Account) => Effect.Effect<Account, unknown>;
  remove: (provider: ProviderId, id: string) => Effect.Effect<void, unknown>;
  setDefault: (provider: ProviderId, id?: string) => Effect.Effect<void, unknown>;
  updateCredential: (provider: ProviderId, id: string, credential: OpenAIAccount["credential"] | string) => Effect.Effect<Account, unknown>;
}
type Mutation<A> = readonly [result: A, state: AccountsState];

export const makeAccountStore = (files: FileStore = makeFileStore()): AccountStoreApi => {
  const run = <A>(work: () => Promise<A>) => Effect.tryPromise({ try: work, catch: (error) => error });
  const locked = <A>(work: () => Promise<A>) => Effect.flatMap(run(files.ensureDirs), () => withLock(files.locks, "accounts-store", run(work)));
  const mutate = <A>(fn: (state: AccountsState) => Mutation<A>) => locked(async () => {
    const [result, state] = fn(await files.load());
    await files.save(state);
    return result;
  });
  const getFrom = (state: AccountsState, provider: ProviderId, id: string) => {
    const accountId = provider === "opencode-go" ? normalizeId(id) : checkId(id);
    const accounts = state.providers[provider].accounts;
    if (!Object.hasOwn(accounts, accountId)) throw new AccountNotFoundError({ provider, accountId, message: "Account was not found" });
    return accounts[accountId]!;
  };
  const get = (provider: ProviderId, id: string) => locked(async () => getFrom(await files.load(), provider, id));

  return {
    load: () => locked(files.load),
    list: (provider) => locked(async () => {
      const state = await files.load();
      return provider ? Object.values(state.providers[provider].accounts) : Object.values(state.providers).flatMap((entry) => Object.values(entry.accounts));
    }),
    get,
    upsert: (input) => mutate<Account>((state) => {
      const label = checkLabel(input.label);
      const now = Date.now();
      if (input.provider === "openai-codex") {
        const group = state.providers["openai-codex"];
        const identity = openAIIdentity(input.credential);
        const identityOf = (credential: OpenAIAccount["credential"]): string | undefined => {
          try { return openAIIdentity(credential); } catch { return undefined; }
        };
        const duplicate = Object.values(group.accounts).find((item) => identityOf(item.credential) === identity);
        const requested = checkId(input.id);
        const id = duplicate?.id ?? availableId(requested, group.accounts);
        const account: OpenAIAccount = duplicate
          ? { ...duplicate, credential: input.credential, updatedAt: now }
          : { ...input, id, label, updatedAt: now, createdAt: input.createdAt };
        return [account, { ...state, providers: { ...state.providers, "openai-codex": { ...group, accounts: { ...group.accounts, [id]: account } } } }];
      }
      const group = state.providers["opencode-go"];
      const id = availableId(normalizeId(input.id), group.accounts);
      const account = { ...input, id, label, updatedAt: now };
      return [account, { ...state, providers: { ...state.providers, "opencode-go": { ...group, accounts: { ...group.accounts, [id]: account } } } }];
    }),
    remove: (provider, id) => mutate<void>((state) => {
      const accountId = getFrom(state, provider, id).id;
      const removeFrom = <A extends Account>(group: { accounts: Readonly<Record<string, A>>; defaultAccount?: string }) => {
        const accounts = { ...group.accounts };
        delete accounts[accountId];
        return { ...group, accounts, defaultAccount: group.defaultAccount === accountId ? undefined : group.defaultAccount };
      };
      const providers = provider === "openai-codex"
        ? { ...state.providers, "openai-codex": removeFrom(state.providers["openai-codex"]) }
        : { ...state.providers, "opencode-go": removeFrom(state.providers["opencode-go"]) };
      return [undefined, { ...state, providers }];
    }),
    setDefault: (provider, id) => mutate<void>((state) => {
      const accountId = id === undefined ? undefined : getFrom(state, provider, id).id;
      const group = state.providers[provider];
      return [undefined, { ...state, providers: { ...state.providers, [provider]: { ...group, defaultAccount: accountId } } } as AccountsState];
    }),
    updateCredential: (provider, id, credential) => mutate<Account>((state) => {
      const account = getFrom(state, provider, id);
      if (provider === "openai-codex") {
        if (typeof credential === "string" || account.provider !== provider) throw new InvalidAccountError({ message: "Credential type is invalid" });
        const updated: OpenAIAccount = { ...account, credential, updatedAt: Date.now() };
        const group = state.providers[provider];
        return [updated, { ...state, providers: { ...state.providers, [provider]: { ...group, accounts: { ...group.accounts, [updated.id]: updated } } } }];
      }
      if (typeof credential !== "string" || account.provider !== provider) throw new InvalidAccountError({ message: "Credential type is invalid" });
      const updated = { ...account, key: credential, updatedAt: Date.now() };
      const group = state.providers[provider];
      return [updated, { ...state, providers: { ...state.providers, [provider]: { ...group, accounts: { ...group.accounts, [updated.id]: updated } } } }];
    }),
  };
};
