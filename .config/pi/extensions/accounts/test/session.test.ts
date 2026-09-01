import { describe, expect, it } from "vitest";
import { emptyAccountsState } from "../domain.ts";
import { makeAccountSelectionPolicy } from "../services/selection-policy.ts";
import { ACCOUNTS_SELECTION_ENTRY, makeSessionService, StaleSessionServiceError } from "../services/session-service.ts";

const custom = (ownerSessionId: string, selections: Record<string, string>) => ({
  type: "custom", customType: ACCOUNTS_SELECTION_ENTRY, data: { version: 1, ownerSessionId, selections },
});
const manager = (id: string, entries: unknown[] = []) => ({
  id, entries,
  getSessionId() { return this.id; },
  getEntries() { return this.entries; },
  appendCustomEntry(customType: string, data: unknown) { this.entries.push({ type: "custom", customType, data }); },
});

describe("account session service", () => {
  it("restores backward from only the latest entry with the same owner", () => {
    const m = manager("child", [custom("child", { "openai-codex": "old" }), custom("parent", { "openai-codex": "copied" }), custom("child", { "openai-codex": "latest" })]);
    expect(makeSessionService(m).get("openai-codex")).toBe("latest");
  });

  it("set and clear append the exact secret-free shape", () => {
    const m = manager("s"); const service = makeSessionService(m);
    service.set("openai-codex", "account-id"); service.clear("openai-codex");
    expect(m.entries).toEqual([
      custom("s", { "openai-codex": "account-id" }),
      custom("s", {}),
    ]);
    expect(JSON.stringify(m.entries)).not.toContain("apiKey");
  });

  it("keeps different managers and fork owners independent", () => {
    const a = manager("a"); const b = manager("b");
    makeSessionService(a).set("opencode-go", "a-account");
    expect(makeSessionService(b).get("opencode-go")).toBeUndefined();
    const fork = manager("fork", [...a.entries]);
    expect(makeSessionService(fork).get("opencode-go")).toBeUndefined();
  });

  it("cannot append with a stale owner and can rebind", () => {
    const m = manager("old"); const service = makeSessionService(m); m.id = "new";
    expect(() => service.set("openai-codex", "account")).toThrow(StaleSessionServiceError);
    expect(m.entries).toHaveLength(0);
    service.rebind().set("openai-codex", "account");
    expect(m.entries).toEqual([custom("new", { "openai-codex": "account" })]);
  });

  it("policy chooses explicit selection, then default, then undefined", () => {
    const m = manager("s"); const session = makeSessionService(m); const empty = emptyAccountsState();
    const state = { ...empty, providers: { ...empty.providers, "openai-codex": { ...empty.providers["openai-codex"], defaultAccount: "default" } } };
    const policy = makeAccountSelectionPolicy(session, state);
    expect(policy.select("openai-codex")).toBe("default");
    session.set("openai-codex", "explicit");
    expect(policy.select("openai-codex")).toBe("explicit");
    expect(policy.select("opencode-go")).toBeUndefined();
  });
});
