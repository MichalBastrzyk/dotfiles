import { Cause, Effect, Exit } from "effect";

/** Runs an Effect as a Promise while preserving its squashed failure cause. */
export const runEffectAsPromise = async <A>(effect: Effect.Effect<A, unknown>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};
