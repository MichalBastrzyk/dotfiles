import { Effect, Schedule, Schema } from "effect";
import {
  UsageAuthError,
  UsageHttpError,
  UsagePayloadError,
  type ProviderId,
} from "../domain.ts";
import type { FetchApi } from "../providers/provider.ts";

const MAX_OK = 64 * 1024;

const safeError = (
  provider: ProviderId,
  message: string,
  retryable = false,
  status?: number,
) => new UsageHttpError({ provider, message, retryable, status });

export interface FetchJsonOptions {
  timeoutMs?: number;
  retryBaseMs?: number;
  retryAfterMaxMs?: number;
  networkRetries?: number;
}

export const readBounded = (
  response: Response,
  max: number,
  provider: ProviderId,
) =>
  Effect.tryPromise({
    try: async (signal) => {
      const declared = Number(response.headers.get("content-length"));

      if (Number.isFinite(declared) && declared > max) {
        await response.body?.cancel();
        throw new Error("large");
      }

      if (!response.body) {
        return "";
      }

      const reader = response.body.getReader();
      const abort = () => {
        void reader.cancel().catch(() => undefined);
      };

      signal.addEventListener("abort", abort, { once: true });

      const chunks: Uint8Array[] = [];
      let size = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          size += value.byteLength;
          if (size > max) {
            await reader.cancel();
            throw new Error("large");
          }

          chunks.push(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        signal.removeEventListener("abort", abort);
        reader.releaseLock();
      }

      const bytes = new Uint8Array(size);
      let offset = 0;

      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return new TextDecoder().decode(bytes);
    },
    catch: () =>
      new UsagePayloadError({
        provider,
        message: "Usage response exceeded the size limit or could not be read",
      }),
  });

export const retryAfter = (value: string | null, now: number, cap: number) => {
  if (!value) {
    return 0;
  }

  const delay = /^\d+(?:\.\d+)?$/u.test(value.trim())
    ? Number(value) * 1_000
    : Date.parse(value) - now;

  return Math.min(cap, Math.max(0, Number.isFinite(delay) ? delay : 0));
};

export const fetchJson = (
  provider: ProviderId,
  url: string,
  credential: string,
  fetcher: FetchApi = fetch,
  options: FetchJsonOptions = {},
): Effect.Effect<
  unknown,
  UsageAuthError | UsageHttpError | UsagePayloadError
> => {
  const request = (
    retry429: boolean,
  ): Effect.Effect<
    unknown,
    UsageAuthError | UsageHttpError | UsagePayloadError
  > =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetcher(url, {
            headers: { Authorization: `Bearer ${credential}` },
            redirect: "error",
            signal,
          }),
        catch: () => safeError(provider, "Usage request failed", true),
      });

      if (!response.ok) {
        yield* Effect.promise(async () => {
          await response.body?.cancel().catch(() => undefined);
        });
      }

      if (response.status === 401 || response.status === 403) {
        return yield* Effect.fail(
          new UsageAuthError({
            provider,
            message: "Usage credentials were rejected",
          }),
        );
      }

      const text = response.ok
        ? yield* readBounded(response, MAX_OK, provider)
        : "";

      if (response.status === 429) {
        if (retry429) {
          const delay = retryAfter(
            response.headers.get("retry-after"),
            Date.now(),
            options.retryAfterMaxMs ?? 1_000,
          );

          yield* Effect.sleep(delay);
          return yield* request(false);
        }

        return yield* Effect.fail(
          safeError(
            provider,
            "Usage endpoint returned HTTP 429",
            true,
            response.status,
          ),
        );
      }

      if (!response.ok) {
        return yield* Effect.fail(
          safeError(
            provider,
            `Usage endpoint returned HTTP ${response.status}`,
            [502, 503, 504].includes(response.status),
            response.status,
          ),
        );
      }

      return yield* Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: () =>
          new UsagePayloadError({
            provider,
            message: "Usage response was malformed",
          }),
      });
    });

  const retried = Effect.retry(request(true), {
    schedule: Schedule.exponential(options.retryBaseMs ?? 100),
    times: options.networkRetries ?? 2,
    while: (error) =>
      error._tag === "UsageHttpError" &&
      error.retryable &&
      error.status !== 429,
  });

  return retried.pipe(
    Effect.timeoutOrElse({
      duration: options.timeoutMs ?? 7_000,
      orElse: () =>
        Effect.fail(safeError(provider, "Usage request timed out", true)),
    }),
  );
};

export const parsePayload = <S extends Schema.ConstraintDecoder<unknown>>(
  provider: ProviderId,
  schema: S,
  value: unknown,
): Effect.Effect<S["Type"], UsagePayloadError> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(value),
    catch: () =>
      new UsagePayloadError({
        provider,
        message: "Usage response had an invalid shape",
      }),
  });
