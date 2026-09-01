import { Effect } from "effect";
import type { Account, AccountUsage, ProviderId } from "../domain.ts";

/** UI-independent seam implemented by each account provider. */
export interface AccountProvider<A extends Account = Account, Input = unknown> {
  readonly id: ProviderId;
  readonly name: string;
  readonly resolveCredential: (accountId: string) => Effect.Effect<string, unknown>;
  readonly getUsage: (account: A, credential: string) => Effect.Effect<AccountUsage, unknown>;
  readonly createAccount: (input: Input) => Effect.Effect<A, unknown>;
  readonly validateAccount: (account: A) => Effect.Effect<void, unknown>;
}

export interface FetchApi { (input: string | URL | Request, init?: RequestInit): Promise<Response> }
export interface ClockApi { now(): number }
