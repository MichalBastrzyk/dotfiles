import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createAccountsExtension } from "../index.ts";
import { emptyAccountsState, UsageAuthError, type AccountUsage, type AccountsState, type OpenCodeAccount } from "../domain.ts";
import { defaultKeybindings } from "../ui/accounts-view.ts";
import { ACCOUNTS_SELECTION_ENTRY } from "../services/session-service.ts";

const identityTheme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
const defaultKb = () => defaultKeybindings();

const account = (id: string): OpenCodeAccount => ({ id, label: id, provider: "opencode-go", kind: "api-key", key: `${id}-saved`, createdAt: 0, updatedAt: 0 });
const stateWith = (accounts: OpenCodeAccount[], defaultAccount?: string): AccountsState => {
  const empty = emptyAccountsState();
  return { ...empty, providers: { ...empty.providers, "opencode-go": { accounts: Object.fromEntries(accounts.map((item) => [item.id, item])), defaultAccount } } };
};
const harness = () => {
  const commands = new Map<string, Function>(), handlers = new Map<string, Function[]>(), emit = vi.fn();
  const pi = {
    registerCommand: (name: string, command: { handler: Function }) => commands.set(name, command.handler),
    on: (name: string, fn: Function) => handlers.set(name, [...handlers.get(name) ?? [], fn]),
    events: { emit },
  };
  const runtime = new Map<string, string>(), abort = vi.fn(), setModel = vi.fn();
  const ctx: any = {
    mode: "tui", model: { provider: "opencode-go", id: "model" }, setModel, abort, hasUI: true,
    waitForIdle: vi.fn(async () => {}),
    ui: { notify: vi.fn(), custom: vi.fn(), confirm: vi.fn(), select: vi.fn(), input: vi.fn() },
    sessionManager: { getSessionId: () => "s", getEntries: () => [], appendCustomEntry: vi.fn() },
    modelRegistry: {
      runtime: { setRuntimeApiKey: (provider: string, key: string) => runtime.set(provider, key), removeRuntimeApiKey: (provider: string) => runtime.delete(provider) },
      getApiKeyForProvider: (provider: string) => runtime.get(provider),
    },
  };
  return { pi, commands, handlers, runtime, ctx, abort, setModel, emit };
};

describe("accounts extension integration", () => {
  it("registers only accounts and synchronizes the default without changing the model", async () => {
    const work = account("work"); let data = stateWith([work], "work");
    const h = harness(), cleanup = vi.fn();
    const store = { load: () => Effect.succeed(data), get: (_provider: string, id: string) => id === "work" ? Effect.succeed(work) : Effect.fail(new Error()), list: () => Effect.succeed([work]) } as never;
    createAccountsExtension({ store, credentials: { resolve: () => Effect.succeed("runtime-key") } as never, providers: new Map([['opencode-go', { validateAccount: () => Effect.void } as never]]), usage: {} as never, cleanupSessionResources: cleanup })(h.pi);
    expect([...h.commands.keys()]).toEqual(["accounts"]);
    expect([...h.handlers.keys()].sort()).toEqual(["before_agent_start", "model_select", "session_shutdown", "session_start", "turn_start"].sort());
    await h.handlers.get("session_start")![0]!({ reason: "new" }, h.ctx);
    expect(h.runtime.get("opencode-go")).toBe("runtime-key");
    data = stateWith([work]);
    await h.handlers.get("before_agent_start")![0]!({}, h.ctx);
    h.handlers.get("turn_start")![0]!({}, h.ctx);
    expect(h.abort).toHaveBeenCalledOnce();
    expect(h.setModel).not.toHaveBeenCalled();
    await h.handlers.get("session_shutdown")![0]!();
    expect(h.runtime.has("opencode-go")).toBe(false);
    expect(cleanup).toHaveBeenCalledWith("s");
  });

  it("fails closed when the account store cannot be read", async () => {
    const h = harness();
    createAccountsExtension({
      store: { load: () => Effect.fail(new Error("corrupt")) } as never,
      credentials: { resolve: () => Effect.succeed("must-not-be-used") } as never,
      providers: new Map(), usage: {} as never,
    })(h.pi);
    await h.handlers.get("session_start")![0]!({ reason: "resume" }, h.ctx);
    expect(h.runtime.get("opencode-go")).toBe("pi-accounts-auth-failed");
    h.handlers.get("turn_start")![0]!({}, h.ctx);
    expect(h.abort).toHaveBeenCalledOnce();
  });

  it("validates an explicit switch before mutating runtime auth", async () => {
    const personal = account("personal"), work = account("work"), data = stateWith([personal, work], "personal");
    const h = harness();
    const store = { load: () => Effect.succeed(data), list: () => Effect.succeed([personal, work]), get: (_provider: string, id: string) => Effect.succeed(id === "work" ? work : personal) } as never;
    const validateAccount = vi.fn((value: OpenCodeAccount) => value.id === "work"
      ? Effect.fail(new UsageAuthError({ provider: "opencode-go", message: "invalid" }))
      : Effect.void);
    createAccountsExtension({
      store, credentials: { resolve: (_provider: string, id: string) => Effect.succeed(`${id}-runtime`) } as never,
      providers: new Map([["opencode-go", { validateAccount } as never]]), usage: {} as never,
    })(h.pi);
    await h.handlers.get("session_start")![0]!({ reason: "new" }, h.ctx);
    // Drive the in-place switch: the factory builds the view, then we fire its
    // onAction directly and await the returned switch promise before closing.
    let view: any;
    h.ctx.ui.custom.mockImplementationOnce((factory: Function) => {
      view = factory({ requestRender: () => {}, terminal: { rows: 30 } }, identityTheme, defaultKb(), () => {});
      const result = (view as any).options.onAction({ type: "switch", account: work });
      return Promise.resolve(result).then(() => undefined);
    });
    await h.commands.get("accounts")!("", h.ctx);
    expect(validateAccount).toHaveBeenCalledWith(work);
    expect(h.runtime.get("opencode-go")).toBe("personal-runtime");
    expect(h.ctx.ui.notify.mock.calls.some(([message]: [string]) => message.includes("credentials rejected"))).toBe(true);
    expect(h.setModel).not.toHaveBeenCalled();
  });

  it("clears a removed session selection so activation falls back to the default", async () => {
    const personal = account("personal"), work = account("work");
    let data = stateWith([personal, work], "personal");
    const h = harness();
    h.ctx.sessionManager.getEntries = () => [{
      type: "custom", customType: ACCOUNTS_SELECTION_ENTRY,
      data: { version: 1, ownerSessionId: "s", selections: { "opencode-go": "work" } },
    }];
    const store = {
      load: () => Effect.succeed(data), list: () => Effect.succeed(Object.values(data.providers["opencode-go"].accounts)),
      get: (_provider: string, id: string) => data.providers["opencode-go"].accounts[id]
        ? Effect.succeed(data.providers["opencode-go"].accounts[id]!)
        : Effect.fail(new Error("missing")),
      remove: () => Effect.sync(() => { data = stateWith([personal], "personal"); }),
    } as never;
    createAccountsExtension({
      store, credentials: { resolve: (_provider: string, id: string) => Effect.succeed(`${id}-runtime`) } as never,
      providers: new Map(), usage: { invalidate: () => Effect.void, all: () => Effect.succeed([]), get: () => Effect.never } as never,
    })(h.pi);
    await h.handlers.get("session_start")![0]!({ reason: "new" }, h.ctx);
    expect(h.runtime.get("opencode-go")).toBe("work-runtime");
    h.ctx.ui.confirm.mockResolvedValue(true);
    h.ctx.ui.custom
      .mockImplementationOnce((factory: Function) => {
        const view = factory({ requestRender: () => {}, terminal: { rows: 30 } }, identityTheme, defaultKb(), () => {});
        (view as any).options.onAction({ type: "remove", account: work });
        view.dispose();
        return Promise.resolve();
      })
      .mockImplementationOnce((factory: Function) => {
        const view = factory({ requestRender: () => {}, terminal: { rows: 30 } }, identityTheme, defaultKb(), () => {});
        (view as any).options.onAction({ type: "close" });
        view.dispose();
        return Promise.resolve();
      });
    await h.commands.get("accounts")!("", h.ctx);
    expect(h.ctx.sessionManager.appendCustomEntry).toHaveBeenLastCalledWith(ACCOUNTS_SELECTION_ENTRY, expect.objectContaining({ selections: {} }));
    await h.handlers.get("before_agent_start")![0]!({}, h.ctx);
    expect(h.runtime.get("opencode-go")).toBe("personal-runtime");
    await h.handlers.get("session_shutdown")![0]!();
  });

  it("does not leak stale-session activation errors from model events", async () => {
    const work = account("work"), data = stateWith([work], "work"), h = harness();
    const store = { load: () => Effect.succeed(data), get: () => Effect.succeed(work), list: () => Effect.succeed([work]) } as never;
    createAccountsExtension({
      store, credentials: { resolve: () => Effect.succeed("runtime-key") } as never,
      providers: new Map(), usage: {} as never,
    })(h.pi);
    await h.handlers.get("session_start")![0]!({ reason: "new" }, h.ctx);
    h.ctx.sessionManager.getSessionId = () => "other";
    await expect(h.handlers.get("model_select")![0]!({ model: h.ctx.model })).resolves.toBeUndefined();
    await expect(h.handlers.get("before_agent_start")![0]!({}, h.ctx)).resolves.toBeUndefined();
    await h.handlers.get("session_shutdown")![0]!();
  });

  it("starts concurrent usage broadcasts even when the selected model has another provider", async () => {
    const h = harness(), list = vi.fn(() => Effect.succeed([])), all = vi.fn(() => Effect.succeed([]));
    h.ctx.model = { provider: "anthropic", id: "model" };
    createAccountsExtension({
      store: { list } as never, credentials: {} as never, providers: new Map(), usage: { all } as never,
    })(h.pi);
    await h.handlers.get("session_start")![0]!({ reason: "new" }, h.ctx);
    await vi.waitFor(() => expect(all).toHaveBeenCalledWith([]));
    expect(list).toHaveBeenCalled();
    expect(h.emit).toHaveBeenCalled();
    await h.handlers.get("session_shutdown")![0]!();
  });

  it("does not emit stale usage after a newer session binding starts", async () => {
    const work = account("work"), h = harness();
    h.ctx.model = { provider: "anthropic", id: "model" };
    let resolveFirst!: (value: ReadonlyArray<AccountUsage>) => void;
    const first = new Promise<ReadonlyArray<AccountUsage>>((resolve) => { resolveFirst = resolve; });
    const all = vi.fn()
      .mockReturnValueOnce(Effect.promise(() => first))
      .mockReturnValueOnce(Effect.succeed([]));
    createAccountsExtension({
      store: { list: () => Effect.succeed([work]) } as never,
      credentials: {} as never, providers: new Map(), usage: { all } as never,
    })(h.pi);
    const start = h.handlers.get("session_start")![0]!;
    await start({ reason: "new" }, h.ctx);
    await vi.waitFor(() => expect(all).toHaveBeenCalledTimes(1));
    await start({ reason: "resume" }, h.ctx);
    await vi.waitFor(() => expect(h.emit).toHaveBeenCalledTimes(1));
    resolveFirst([{ accountId: "work", provider: "opencode-go", windows: {}, updatedAt: 0 }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.emit).toHaveBeenCalledTimes(1);
    await h.handlers.get("session_shutdown")![0]!();
  });

  it("releases the previous binding before starting another session", async () => {
    const work = account("work"), data = stateWith([work], "work");
    const h = harness(), cleanup = vi.fn();
    const store = { load: () => Effect.succeed(data), get: () => Effect.succeed(work), list: () => Effect.succeed([work]) } as never;
    createAccountsExtension({
      store, credentials: { resolve: () => Effect.succeed("runtime-key") } as never,
      providers: new Map(), usage: {} as never, cleanupSessionResources: cleanup,
    })(h.pi);
    const start = h.handlers.get("session_start")![0]!;
    await start({ reason: "new" }, h.ctx);
    await start({ reason: "resume" }, h.ctx);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(h.runtime.get("opencode-go")).toBe("runtime-key");
    await h.handlers.get("session_shutdown")![0]!();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
});
