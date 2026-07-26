/**
 * Deferred one-shot delivery map (same semantics as subagents'): a settled
 * terminal's result is held here until it is either drained into a follow-up
 * message or consumed by a tool call (bg_kill / bg_status) that already
 * returned the settlement itself. Keyed by id, so double delivery is
 * structurally impossible — whoever drains first wins.
 */
export async function consumeDeferredResultsOnSuccess<
  T extends { id: string },
  A,
>(
  delivery: {
    defer(result: T): void;
    consume(ids: Iterable<string>): void;
  },
  ids: Iterable<string>,
  operation: () => Promise<A>,
  recoverSettled: () => Iterable<T>,
): Promise<A> {
  try {
    const result = await operation();
    delivery.consume(ids);
    return result;
  } catch (error) {
    for (const result of recoverSettled()) delivery.defer(result);
    throw error;
  }
}

export function createDeferredResultDelivery<T extends { id: string }>() {
  const pending = new Map<string, T>();

  return {
    defer(result: T) {
      pending.set(result.id, result);
    },
    consume(ids: Iterable<string>) {
      for (const id of ids) pending.delete(id);
    },
    drain() {
      const results = [...pending.values()];
      pending.clear();
      return results;
    },
    clear() {
      pending.clear();
    },
  };
}
