import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Semaphore } from "effect";
import { LockError } from "../domain.ts";

const semaphores = new Map<string, Semaphore.Semaphore>();
const POSIX_PERMISSIONS = typeof process.getuid === "function";

const semaphoreFor = (key: string) => {
  let value = semaphores.get(key);
  if (!value) semaphores.set(key, value = Semaphore.makeUnsafe(1));
  return value;
};

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(done, ms);
  const abort = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    reject(signal?.reason ?? new Error("Aborted"));
  };
  function done() {
    signal?.removeEventListener("abort", abort);
    resolve();
  }
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
});

const lockName = (key: string) => {
  const safe = key.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 32) || "lock";
  return `${safe}-${createHash("sha256").update(key).digest("hex").slice(0, 24)}.lock`;
};

const secureLockDirectory = async (locksDir: string) => {
  await mkdir(locksDir, { recursive: true, mode: 0o700 });
  const directory = await lstat(locksDir);
  if (directory.isSymbolicLink() || !directory.isDirectory() ||
      (POSIX_PERMISSIONS && directory.uid !== process.getuid!()))
    throw new LockError({ message: "Accounts lock directory is insecure" });
  if (POSIX_PERMISSIONS) await chmod(locksDir, 0o700);
};

const createOwnedLock = async (path: string) => {
  await mkdir(path, { mode: 0o700 });
  const metadata = join(path, "owner.json");
  const token = randomBytes(32).toString("hex");

  try {
    const file = await open(metadata, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now(), token }));
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (error: any) {
    if (error?.code !== "EEXIST") await rm(path, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return async () => {
    try {
      const owner = JSON.parse(await readFile(metadata, "utf8"));
      if (owner.token === token) await rm(path, { recursive: true, force: true });
    } catch {
      // The lock was already reclaimed or its ownership changed.
    }
  };
};

const readLockAge = async (path: string) => {
  let createdAt: number;
  try {
    const metadata = JSON.parse(await readFile(join(path, "owner.json"), "utf8"));
    createdAt = typeof metadata.createdAt === "number" ? metadata.createdAt : (await stat(path)).mtimeMs;
  } catch {
    createdAt = (await stat(path)).mtimeMs;
  }
  return Date.now() - createdAt;
};

const reclaimStaleLock = async (path: string) => {
  const stale = `${path}.stale-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await rename(path, stale);
    await rm(stale, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
};

export interface LockOptions {
  waitMs?: number;
  staleMs?: number;
  retryMs?: number;
}

const defaultTiming = (options: LockOptions) => ({
  waitMs: options.waitMs ?? 10_000,
  staleMs: options.staleMs ?? 120_000,
  retryMs: options.retryMs ?? 25,
});

const tryStaleReclaim = async (path: string, staleMs: number) => {
  try {
    return await readLockAge(path) > staleMs && await reclaimStaleLock(path);
  } catch {
    // Another contender changed the lock while it was inspected.
    return false;
  }
};

const tryAcquireOnce = async (path: string, staleMs: number) => {
  try {
    return { release: await createOwnedLock(path), reclaimed: false };
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw new LockError({ message: "Unable to acquire accounts lock" });
  }
  return { release: undefined, reclaimed: await tryStaleReclaim(path, staleMs) };
};

const acquireFs = async (locksDir: string, key: string, options: LockOptions, signal?: AbortSignal) => {
  const { waitMs, staleMs, retryMs } = defaultTiming(options);
  await secureLockDirectory(locksDir);
  const path = join(locksDir, lockName(key));
  const deadline = Date.now() + waitMs;

  for (;;) {
    const { release, reclaimed } = await tryAcquireOnce(path, staleMs);
    if (release) return release;
    if (reclaimed) continue;
    if (Date.now() >= deadline) throw new LockError({ message: "Timed out waiting for accounts lock" });
    await sleep(retryMs + Math.floor(Math.random() * retryMs), signal);
  }
};

const acquireLock = (locksDir: string, key: string, options: LockOptions = {}) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: (signal) => acquireFs(locksDir, key, options, signal),
      catch: () => new LockError({ message: "Unable to acquire accounts lock" }),
    }),
    (release) => Effect.promise(release),
  );

export const withLock = <A, E, R>(locksDir: string, key: string, effect: Effect.Effect<A, E, R>, options: LockOptions = {}) =>
  semaphoreFor(`${locksDir}\0${key}`).withPermit(Effect.scoped(Effect.flatMap(acquireLock(locksDir, key, options), () => effect)));

export const withLockPromise = <A>(locksDir: string, key: string, work: () => Promise<A>, options: LockOptions = {}) =>
  Effect.runPromise(withLock(locksDir, key, Effect.promise(work), options));
