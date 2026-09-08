import { Effect, Schema } from "effect";
import {
  UsagePayloadError,
  type CheaperInferenceAccount,
  type UsageSummary,
} from "../domain.ts";
import type { AccountStoreApi } from "../services/account-store.ts";
import { fetchJson, parsePayload } from "../services/usage-http.ts";
import type { AccountProvider, ClockApi, FetchApi } from "./provider.ts";

/**
 * CheaperInference managed API-key login.
 *
 * Suggested key when creating in the dashboard (name `pi`):
 * scopes `inference` + `usage:read` + `account:read`, without `account:write`.
 * Login is validated via GET /v1/models (any valid key works); usage needs
 * `usage:read` and the wallet balance needs `account:read` — both degrade to
 * `unavailable` / hidden without blocking inference.
 */
export const CHEAPER_INFERENCE_BASE_URL = "https://api.cheaperinference.com/v1";
export const CHEAPER_INFERENCE_MODELS_URL = `${CHEAPER_INFERENCE_BASE_URL}/models`;
export const CHEAPER_INFERENCE_DAILY_URL = `${CHEAPER_INFERENCE_BASE_URL}/usage/daily`;
export const CHEAPER_INFERENCE_BALANCE_URL = `${CHEAPER_INFERENCE_BASE_URL}/account/balance`;
export const CHEAPER_INFERENCE_KEYS_URL =
  "https://api.cheaperinference.com/dashboard/keys";

const ModelList = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
});

const DailySpendEntry = Schema.Struct({
  date: Schema.optional(Schema.String),
  spend_usd: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
});
const DailyPayload = Schema.Struct({
  spend_usd: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  total_requests: Schema.optional(Schema.Number),
  settled_requests: Schema.optional(Schema.Number),
  daily_spend: Schema.optional(Schema.Array(DailySpendEntry)),
});
const BalancePayload = Schema.Struct({
  available_usd: Schema.optional(Schema.Number),
});

const toSpendUsd = (value: string | number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

/** Local calendar date (YYYY-MM-DD) for a unix timestamp, honoring the timezone offset. */
export const localDateKey = (now: number): string => {
  const offsetMinutes = -new Date(now).getTimezoneOffset();
  return new Date(now + offsetMinutes * 60_000).toISOString().slice(0, 10);
};

/** Minutes east of UTC for the /v1/usage/daily timezone_offset_minutes parameter. */
export const timezoneOffsetMinutes = (now: number): number =>
  -new Date(now).getTimezoneOffset();

export interface CheaperInferenceProviderOptions {
  store: AccountStoreApi;
  fetch?: FetchApi;
  clock?: ClockApi;
}

export const makeCheaperInferenceProvider = ({
  store,
  fetch: fetcher,
  clock = { now: Date.now },
}: CheaperInferenceProviderOptions): AccountProvider<
  CheaperInferenceAccount,
  { id: string; label: string; key: string }
> => {
  const checkModels = (key: string) =>
    Effect.gen(function* () {
      const raw = yield* fetchJson(
        "cheaper-inference",
        CHEAPER_INFERENCE_MODELS_URL,
        key,
        fetcher,
      );
      yield* parsePayload("cheaper-inference", ModelList, raw);
    });

  const getUsage = (account: CheaperInferenceAccount, key: string) =>
    Effect.gen(function* () {
      // Each endpoint degrades independently: a key without usage:read still
      // shows the balance (account:read) and vice versa. Only when BOTH fail
      // does the whole usage become unavailable.
      let dailyError: unknown;
      const dailyUrl = `${CHEAPER_INFERENCE_DAILY_URL}?timezone_offset_minutes=${timezoneOffsetMinutes(clock.now())}`;
      const data = yield* Effect.catch(
        Effect.flatMap(fetchJson("cheaper-inference", dailyUrl, key, fetcher), (raw) =>
          parsePayload("cheaper-inference", DailyPayload, raw),
        ),
        (error) => {
          dailyError = error;
          return Effect.succeed(undefined);
        },
      );
      const spendUsd = data === undefined ? undefined : toSpendUsd(data.spend_usd);
      const requests = data === undefined ? undefined : data.total_requests ?? data.settled_requests;
      if (
        (spendUsd !== undefined && !(spendUsd >= 0)) ||
        (requests !== undefined && !(Number.isFinite(requests) && requests >= 0))
      )
        return yield* Effect.fail(
          new UsagePayloadError({
            provider: "cheaper-inference",
            message: "Usage response had an invalid shape",
          }),
        );
      // Balance requires account:read; a usage-only key keeps working without it.
      const availableUsdRaw = yield* Effect.catch(
        Effect.flatMap(
          fetchJson("cheaper-inference", CHEAPER_INFERENCE_BALANCE_URL, key, fetcher),
          (raw) =>
            Effect.map(
              parsePayload("cheaper-inference", BalancePayload, raw),
              (balance) => balance.available_usd,
            ),
        ),
        () => Effect.succeed<number | undefined>(undefined),
      );
      const availableUsd =
        availableUsdRaw !== undefined && Number.isFinite(availableUsdRaw) && availableUsdRaw >= 0
          ? availableUsdRaw
          : undefined;
      if (data === undefined && availableUsd === undefined) {
        return yield* Effect.fail(
          dailyError ??
            new UsagePayloadError({
              provider: "cheaper-inference",
              message: "Usage and balance are unavailable",
            }),
        );
      }
      const todayKey = localDateKey(clock.now());
      const spendUsdToday = data?.daily_spend
        ?.map((entry) => (entry.date === todayKey ? toSpendUsd(entry.spend_usd) : undefined))
        .find((value) => value !== undefined);
      const summary: UsageSummary | undefined =
        spendUsd === undefined &&
        requests === undefined &&
        availableUsd === undefined &&
        spendUsdToday === undefined
          ? undefined
          : { spendUsd, spendUsdToday, requests, availableUsd };
      return {
        accountId: account.id,
        provider: "cheaper-inference" as const,
        windows: {},
        updatedAt: clock.now(),
        summary,
      };
    });

  return {
    id: "cheaper-inference",
    name: "CheaperInference",
    resolveCredential: (id) =>
      Effect.map(store.get("cheaper-inference", id), (account) => {
        if (account.provider !== "cheaper-inference") throw new Error("Account was not found");
        return account.key;
      }),
    getUsage,
    createAccount: ({ id, label, key }) =>
      Effect.gen(function* () {
        const now = clock.now();
        const candidate: CheaperInferenceAccount = {
          id,
          label,
          key,
          provider: "cheaper-inference",
          kind: "api-key",
          createdAt: now,
          updatedAt: now,
        };
        yield* checkModels(key);
        return (yield* store.upsert(
          candidate,
        )) as unknown as CheaperInferenceAccount;
      }),
    validateAccount: (account) => Effect.asVoid(checkModels(account.key)),
  };
};
