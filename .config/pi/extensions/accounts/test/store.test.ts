import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { emptyAccountsState, InsecureStorageError, InvalidAccountError, InvalidStateError, type OpenCodeAccount } from "../domain.ts";
import { defaultAccountsRoot, makeFileStore } from "../storage/file-store.ts";
import { withLockPromise } from "../storage/lock.ts";
import { makeAccountStore } from "../services/account-store.ts";

const roots: string[] = [];
const root = async () => { const value = await mkdtemp(join(tmpdir(), "pi-accounts-")); roots.push(value); return value; };
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const oauth = (id: string, external = id) => ({
  id, provider: "openai-codex" as const, kind: "oauth" as const, label: id,
  credential: {
    type: "oauth" as const,
    access: `x.${Buffer.from(JSON.stringify({ sub: external, "https://api.openai.com/auth": { chatgpt_account_id: external } })).toString("base64url")}.y`,
    refresh: "y", expires: 1, accountId: external,
  },
  createdAt: 1, updatedAt: 1,
});
const apiKey = (id: string, key = id, label = id): OpenCodeAccount => ({ id, provider: "opencode-go", kind: "api-key", label, key, createdAt: 1, updatedAt: 1 });

describe("accounts file store", () => {
  it("falls back from empty or relative XDG data roots", () => {
    const previous = process.env.XDG_DATA_HOME;
    try {
      process.env.XDG_DATA_HOME = "";
      expect(defaultAccountsRoot()).toBe(join(homedir(), ".local", "share", "pi", "accounts"));
      process.env.XDG_DATA_HOME = "relative";
      expect(defaultAccountsRoot()).toBe(join(homedir(), ".local", "share", "pi", "accounts"));
      process.env.XDG_DATA_HOME = join(tmpdir(), "xdg");
      expect(defaultAccountsRoot()).toBe(join(tmpdir(), "xdg", "pi", "accounts"));
    } finally {
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
    }
  });
  it("returns empty state when missing and roundtrips", async () => {
    const files = makeFileStore(await root());
    expect(await files.load()).toEqual(emptyAccountsState());
    const empty = emptyAccountsState();
    const state = { ...empty, providers: { ...empty.providers, "openai-codex": { ...empty.providers["openai-codex"], accounts: { a: oauth("a") } } } };
    await files.save(state);
    expect(await files.load()).toEqual(state);
  });
  it("rejects invalid JSON and versions", async () => {
    const files = makeFileStore(await root()); await files.ensureDirs();
    await writeFile(files.file, "no", { mode: 0o600 });
    await expect(files.load()).rejects.toBeInstanceOf(InvalidStateError);
    await writeFile(files.file, JSON.stringify({ version: 2, providers: {} }), { mode: 0o600 });
    await expect(files.load()).rejects.toBeInstanceOf(InvalidStateError);
  });
  it("rejects symlinks and insecure permissions", async () => {
    const dir = await root(); const files = makeFileStore(dir); const target = join(dir, "target");
    await writeFile(target, "{}", { mode: 0o600 }); await symlink(target, files.file);
    await expect(files.load()).rejects.toBeInstanceOf(InsecureStorageError);
    await rm(files.file); await writeFile(files.file, "{}", { mode: 0o644 });
    await expect(files.load()).rejects.toBeInstanceOf(InsecureStorageError);
    await rm(files.file); await writeFile(files.file, "{}", { mode: 0o400 });
    await expect(files.load()).rejects.toBeInstanceOf(InsecureStorageError);
  });
  it("rejects a symlinked data root", async () => {
    const parent = await root(), target = join(parent, "target"), link = join(parent, "link");
    await mkdir(target); await symlink(target, link);
    await expect(makeFileStore(link).save(emptyAccountsState())).rejects.toBeInstanceOf(InsecureStorageError);
  });
  it("sets final modes and leaves no temporary files after rejected save", async () => {
    const files = makeFileStore(await root()); await files.save(emptyAccountsState());
    expect((await stat(files.root)).mode & 0o777).toBe(0o700);
    expect((await stat(files.locks)).mode & 0o777).toBe(0o700);
    expect((await stat(files.file)).mode & 0o777).toBe(0o600);
    await expect(files.save({ version: 2 } as never)).rejects.toBeInstanceOf(InvalidStateError);
    expect((await readdir(files.root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("account store and locks", () => {
  it("rejects an OpenAI credential whose user identity cannot be decoded", async () => {
    const store = makeAccountStore(makeFileStore(await root()));
    const malformed = oauth("broken");
    await expect(Effect.runPromise(store.upsert({ ...malformed, credential: { ...malformed.credential, access: "not-a-jwt" } }))).rejects.toBeInstanceOf(InvalidAccountError);
  });
  it("ignores an invalid stored OpenAI identity while matching a new account", async () => {
    const files = makeFileStore(await root()), malformed = oauth("broken");
    const empty = emptyAccountsState();
    await files.save({ ...empty, providers: { ...empty.providers, "openai-codex": { accounts: { broken: { ...malformed, credential: { ...malformed.credential, access: "not-a-jwt" } } } } } });
    const saved = await Effect.runPromise(makeAccountStore(files).upsert(oauth("valid")));
    expect(saved.id).toBe("valid");
  });
  it("treats inherited object keys as available account ids", async () => {
    const store = makeAccountStore(makeFileStore(await root()));
    const saved = await Effect.runPromise(store.upsert(apiKey("constructor")));
    expect(saved.id).toBe("constructor");
    expect((await Effect.runPromise(store.get("opencode-go", "constructor"))).id).toBe("constructor");
  });
  it("does not lose concurrent updates and deduplicates external OAuth ids", async () => {
    const files = makeFileStore(await root()); const store = makeAccountStore(files);
    await Promise.all(Array.from({ length: 12 }, (_, i) => Effect.runPromise(store.upsert(oauth(`a${i}`)))));
    expect((await files.load()).providers["openai-codex"].accounts).toHaveProperty("a11");
    expect(Object.keys((await files.load()).providers["openai-codex"].accounts)).toHaveLength(12);
    await Effect.runPromise(store.upsert(oauth("other", "a1")));
    expect(Object.keys((await files.load()).providers["openai-codex"].accounts)).toHaveLength(12);
    const deduped = (await files.load()).providers["openai-codex"].accounts.a1;
    expect(deduped.label).toBe("a1");
    expect(deduped.credential.access).toBe(oauth("a1").credential.access);
  });
  it("refreshes the credential and keeps the original label when the same ChatGPT account is re-added", async () => {
    const files = makeFileStore(await root()), store = makeAccountStore(files);
    await Effect.runPromise(store.upsert(oauth("michal", "ext-1")));
    const again = await Effect.runPromise(store.upsert(oauth("pawel", "ext-1")));
    expect(again.id).toBe("michal");
    expect(again.label).toBe("michal");
    const stored = (await files.load()).providers["openai-codex"].accounts;
    expect(Object.keys(stored)).toHaveLength(1);
    expect(stored.michal.credential.accountId).toBe("ext-1");
  });
  it("keeps separate seats for two users in the same ChatGPT workspace", async () => {
    const files = makeFileStore(await root()), store = makeAccountStore(files);
    const jwt = (email: string) => `x.${Buffer.from(JSON.stringify({
      sub: "google-user", "https://api.openai.com/auth": { chatgpt_account_id: "f5152bdf-56a2" },
      "https://api.openai.com/profile": { email },
    })).toString("base64url")}.y`;
    await Effect.runPromise(store.upsert({ ...oauth("michal", "f5152bdf-56a2"), credential: { ...oauth("m", "f5152bdf-56a2").credential, access: jwt("michal@example.com") } }));
    await Effect.runPromise(store.upsert({ ...oauth("pawel", "f5152bdf-56a2"), credential: { ...oauth("p", "f5152bdf-56a2").credential, access: jwt("pawel@example.com") } }));
    await Effect.runPromise(store.upsert({ ...oauth("michal-again", "f5152bdf-56a2"), credential: { ...oauth("m2", "f5152bdf-56a2").credential, access: jwt("michal@example.com") } }));
    const stored = (await files.load()).providers["openai-codex"].accounts;
    expect(Object.keys(stored).sort()).toEqual(["michal", "pawel"]);
    const emailOf = (account: { credential: { access: string } }) => JSON.parse(Buffer.from(account.credential.access.split(".")[1]!, "base64url").toString("utf8"))["https://api.openai.com/profile"].email;
    expect(emailOf(stored.michal)).toBe("michal@example.com");
    expect(emailOf(stored.pawel)).toBe("pawel@example.com");
  });
  it("does not overwrite concurrent API-key accounts with the same requested id", async () => {
    const files = makeFileStore(await root()), store = makeAccountStore(files);
    await Promise.all(Array.from({ length: 4 }, (_, index) => Effect.runPromise(store.upsert(apiKey("personal", `key-${index}`)))));
    const accounts = Object.values((await files.load()).providers["opencode-go"].accounts);
    expect(accounts.map((account) => account.id).sort()).toEqual(["personal", "personal-2", "personal-3", "personal-4"]);
    expect(new Set(accounts.map((account) => account.key)).size).toBe(4);
  });
  it("rejects labels containing terminal controls", async () => {
    const store = makeAccountStore(makeFileStore(await root()));
    await expect(Effect.runPromise(store.upsert(apiKey("bad", "key", "bad\u001b[31m")))).rejects.toBeInstanceOf(InvalidAccountError);
  });
  it("releases after failure", async () => {
    const files = makeFileStore(await root());
    await expect(withLockPromise(files.locks, "k", async () => { throw new Error("failure"); })).rejects.toThrow("failure");
    await expect(withLockPromise(files.locks, "k", async () => 42)).resolves.toBe(42);
  });
  it("safely recovers a stale lock", async () => {
    const files = makeFileStore(await root()); await files.ensureDirs();
    const key = "stale"; const name = `${key}-${createHash("sha256").update(key).digest("hex").slice(0, 24)}.lock`;
    const path = join(files.locks, name); await mkdir(path, { mode: 0o700 });
    await writeFile(join(path, "owner.json"), JSON.stringify({ pid: 0, createdAt: 1 }), { mode: 0o600 });
    await expect(withLockPromise(files.locks, key, async () => "ok", { staleMs: 1 })).resolves.toBe("ok");
  });
});
