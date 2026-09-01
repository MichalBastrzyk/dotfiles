import { ExtensionSelectorComponent, LoginDialogComponent } from "@earendil-works/pi-coding-agent";
import type { NativeProviderAuthInteraction } from "../providers/openai-codex.ts";

export const makeOAuthInteraction = async (ctx: any, ownerSignal: AbortSignal): Promise<NativeProviderAuthInteraction> => {
  if (ctx.mode !== "tui") throw new Error("OAuth login requires the TUI");
  const controller = new AbortController();
  const abort = () => controller.abort();
  ownerSignal.addEventListener("abort", abort, { once: true });
  if (ownerSignal.aborted) controller.abort();
  let resolveDialog!: (value: any) => void;
  let rejectDialog!: (error: unknown) => void;
  const ready = new Promise<any>((resolve, reject) => { resolveDialog = resolve; rejectDialog = reject; });
  let requestRender = () => {};
  let activeComponent: any;
  void Promise.resolve().then(() => ctx.ui.custom((tui: any, _theme: any, _kb: any, done: () => void) => {
    requestRender = () => tui.requestRender();
    const login = new LoginDialogComponent(tui, "openai-codex", () => { controller.abort(); done(); }, "OpenAI Codex");
    activeComponent = login;
    resolveDialog(login);
    const close = () => done();
    controller.signal.addEventListener("abort", close, { once: true });
    if (controller.signal.aborted) close();
    return {
      render: (width: number) => activeComponent.render(width),
      handleInput: (data: string) => activeComponent.handleInput(data),
      invalidate: () => activeComponent.invalidate(),
      dispose: () => {
        ownerSignal.removeEventListener("abort", abort);
        controller.signal.removeEventListener("abort", close);
        controller.abort();
        if (activeComponent !== login) activeComponent?.dispose?.();
        (login as { dispose?: () => void }).dispose?.();
      },
    };
  })).catch((error) => { ownerSignal.removeEventListener("abort", abort); controller.abort(); rejectDialog(error); });
  const login = await ready;
  const cancelled = <A>(promise: PromiseLike<A>, promptSignal?: AbortSignal) => new Promise<A>((resolve, reject) => {
    const fail = () => reject(new Error("Login cancelled"));
    if (controller.signal.aborted || promptSignal?.aborted) return fail();
    controller.signal.addEventListener("abort", fail, { once: true });
    promptSignal?.addEventListener("abort", fail, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      controller.signal.removeEventListener("abort", fail);
      promptSignal?.removeEventListener("abort", fail);
    });
  });
  return {
    signal: controller.signal,
    notify: (event) => {
      if (event.type === "auth_url") login.showAuth(event.url, event.instructions);
      else if (event.type === "device_code") login.showDeviceCode(event);
      else if (event.type === "progress") login.showProgress(event.message);
      else login.showInfo(event.message, event.links);
    },
    prompt: async (prompt) => {
      if (prompt.signal?.aborted || controller.signal.aborted) throw new Error("Login cancelled");
      if (prompt.type === "manual_code") return cancelled(login.showManualInput(prompt.message), prompt.signal);
      if (prompt.type === "text" || prompt.type === "secret") return cancelled(login.showPrompt(prompt.message, prompt.placeholder), prompt.signal);
      const options = prompt.options;
      return cancelled(new Promise<string>((resolve, reject) => {
        const labels = options.map((option) => option.description ? `${option.label} — ${option.description}` : option.label);
        const restore = () => { activeComponent?.dispose?.(); activeComponent = login; requestRender(); };
        activeComponent = new ExtensionSelectorComponent(prompt.message, labels, (label) => {
          const selected = options[labels.indexOf(label)];
          restore();
          if (selected) resolve(selected.id); else reject(new Error("Login cancelled"));
        }, () => { restore(); reject(new Error("Login cancelled")); });
        requestRender();
      }), prompt.signal);
    },
  };
};
