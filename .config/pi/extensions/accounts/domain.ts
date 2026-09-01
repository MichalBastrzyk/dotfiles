import { Schema } from "effect";

const ProviderId = Schema.Literals(["openai-codex", "opencode-go"]);
export type ProviderId = typeof ProviderId.Type;

const AccountId = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u));
const Label = Schema.String.check(Schema.isPattern(/^[^\u0000-\u001f\u007f-\u009f]{1,128}$/u));
const Secret = Schema.String.check(Schema.isPattern(/^\S+$/u));
const Timestamp = Schema.Finite;
const Timestamps = {
  createdAt: Timestamp,
  updatedAt: Timestamp,
};

const OpenAIAccount = Schema.Struct({
  id: AccountId,
  provider: Schema.Literal("openai-codex"),
  kind: Schema.Literal("oauth"),
  label: Label,
  credential: Schema.Struct({
    type: Schema.Literal("oauth"),
    access: Secret,
    refresh: Secret,
    expires: Timestamp,
    accountId: Secret,
  }),
  ...Timestamps,
});
export type OpenAIAccount = typeof OpenAIAccount.Type;

const OpenCodeAccount = Schema.Struct({
  id: AccountId,
  provider: Schema.Literal("opencode-go"),
  kind: Schema.Literal("api-key"),
  label: Label,
  key: Secret,
  ...Timestamps,
});
export type OpenCodeAccount = typeof OpenCodeAccount.Type;

const Account = Schema.Union([OpenAIAccount, OpenCodeAccount]);
export type Account = typeof Account.Type;

const OpenAIProviderAccounts = Schema.Struct({
  defaultAccount: Schema.optional(AccountId),
  accounts: Schema.Record(Schema.String, OpenAIAccount),
});
const OpenCodeProviderAccounts = Schema.Struct({
  defaultAccount: Schema.optional(AccountId),
  accounts: Schema.Record(Schema.String, OpenCodeAccount),
});
export const AccountsState = Schema.Struct({
  version: Schema.Literal(1),
  providers: Schema.Struct({
    "openai-codex": OpenAIProviderAccounts,
    "opencode-go": OpenCodeProviderAccounts,
  }),
});
export type AccountsState = typeof AccountsState.Type;

export const emptyAccountsState = (): AccountsState => ({
  version: 1,
  providers: {
    "openai-codex": { accounts: {} },
    "opencode-go": { accounts: {} },
  },
});

const UsageWindow = Schema.Struct({
  used: Schema.Number,
  limit: Schema.Number,
  resetsAt: Schema.optional(Schema.Number),
});
export type UsageWindow = typeof UsageWindow.Type;
const AccountUsage = Schema.Struct({
  accountId: AccountId,
  provider: ProviderId,
  windows: Schema.Record(Schema.String, UsageWindow),
  updatedAt: Schema.Number,
  state: Schema.optional(Schema.Literals(["fresh", "stale", "unavailable"])),
  plan: Schema.optional(Schema.String),
});
export type AccountUsage = typeof AccountUsage.Type;
export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  operation: Schema.String,
  message: Schema.String,
}) {}
export class InvalidStateError extends Schema.TaggedError<InvalidStateError>()("InvalidStateError", {
  message: Schema.String,
}) {}
export class InsecureStorageError extends Schema.TaggedError<InsecureStorageError>()("InsecureStorageError", {
  message: Schema.String,
}) {}
export class LockError extends Schema.TaggedError<LockError>()("LockError", {
  message: Schema.String,
}) {}
export class InvalidAccountError extends Schema.TaggedError<InvalidAccountError>()("InvalidAccountError", {
  message: Schema.String,
}) {}
export class AccountNotFoundError extends Schema.TaggedError<AccountNotFoundError>()("AccountNotFoundError", {
  provider: ProviderId,
  accountId: Schema.String,
  message: Schema.String,
}) {}
export class CredentialRefreshError extends Schema.TaggedError<CredentialRefreshError>()("CredentialRefreshError", {
  provider: ProviderId, accountId: Schema.String, message: Schema.String,
}) {}
export class UsageProviderError extends Schema.TaggedError<UsageProviderError>()("UsageProviderError", {
  provider: ProviderId, message: Schema.String,
}) {}
export class UsageAuthError extends Schema.TaggedError<UsageAuthError>()("UsageAuthError", {
  provider: ProviderId, message: Schema.String,
}) {}
export class UsageHttpError extends Schema.TaggedError<UsageHttpError>()("UsageHttpError", {
  provider: ProviderId, message: Schema.String, retryable: Schema.Boolean, status: Schema.optional(Schema.Number),
}) {}
export class UsagePayloadError extends Schema.TaggedError<UsagePayloadError>()("UsagePayloadError", {
  provider: ProviderId, message: Schema.String,
}) {}
