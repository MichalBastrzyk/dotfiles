import { InvalidAccountError, type ProviderId } from "../domain.ts";

export const ACCOUNTS_SELECTION_ENTRY = "accounts-selection";
interface AccountSelections { "openai-codex"?: string; "opencode-go"?: string }
interface AccountSelectionState { version: 1; ownerSessionId: string; selections: AccountSelections }
export interface SessionManagerLike {
  getSessionId(): string;
  getEntries(): ReadonlyArray<unknown>;
}
type WritableSessionManager = SessionManagerLike & { appendCustomEntry(type: string, data: unknown): unknown };

const payloadOf = (entry: unknown): unknown => {
  if (!entry || typeof entry !== "object") return undefined;
  const value = entry as Record<string, unknown>;
  return value.type === "custom" && value.customType === ACCOUNTS_SELECTION_ENTRY ? value.data
    : value.customType === ACCOUNTS_SELECTION_ENTRY ? value.data
    : undefined;
};
const ACCOUNT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const valid = (value: unknown, owner: string): value is AccountSelectionState => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || item.ownerSessionId !== owner || !item.selections || typeof item.selections !== "object") return false;
  return Object.entries(item.selections as object).every(([provider, id]) =>
    (provider === "openai-codex" || provider === "opencode-go") && typeof id === "string" && ACCOUNT_ID.test(id));
};

export class StaleSessionServiceError extends Error {
  readonly name = "StaleSessionServiceError";
  constructor() { super("Session changed; create a fresh account session service"); }
}

export const makeSessionService = (manager: SessionManagerLike) => {
  const ownerSessionId = manager.getSessionId();
  let selections: AccountSelections = {};
  const entries = manager.getEntries();
  if (manager.getSessionId() !== ownerSessionId) throw new StaleSessionServiceError();
  for (let i = entries.length - 1; i >= 0; i--) {
    const value = payloadOf(entries[i]);
    if (valid(value, ownerSessionId)) { selections = { ...value.selections }; break; }
  }
  const assertOwner = () => {
    if (manager.getSessionId() !== ownerSessionId) throw new StaleSessionServiceError();
  };
  const persist = () => {
    assertOwner();
    return (manager as WritableSessionManager).appendCustomEntry(ACCOUNTS_SELECTION_ENTRY, {
      version: 1, ownerSessionId, selections: { ...selections },
    } satisfies AccountSelectionState);
  };
  return {
    get: (provider: ProviderId) => { assertOwner(); return selections[provider]; },
    current: () => { assertOwner(); return { ...selections }; },
    set: (provider: ProviderId, accountId: string) => {
      assertOwner();
      if (!ACCOUNT_ID.test(accountId)) throw new InvalidAccountError({ message: "Account selection is invalid" });
      const previous = selections;
      selections = { ...selections, [provider]: accountId };
      try { persist(); } catch (error) { selections = previous; throw error; }
    },
    clear: (provider: ProviderId) => {
      assertOwner();
      const previous = selections;
      const next = { ...selections }; delete next[provider]; selections = next;
      try { persist(); } catch (error) { selections = previous; throw error; }
    },
    rebind: () => makeSessionService(manager),
  };
};
export type SessionService = ReturnType<typeof makeSessionService>;
