import { constants, type Stats } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { emptyAccountsState, InsecureStorageError, InvalidStateError, StorageError, type AccountsState } from "../domain.ts";
import { decodeAccountsState, encodeAccountsState, validateAccountsState } from "./schema.ts";

const MAX_BYTES = 1024 * 1024;
const POSIX_PERMISSIONS = typeof process.getuid === "function";

export const defaultAccountsRoot = () => {
  const configured = process.env.XDG_DATA_HOME;
  const base = configured && isAbsolute(configured) ? configured : join(homedir(), ".local", "share");
  return join(base, "pi", "accounts");
};

export type FileStore = ReturnType<typeof makeFileStore>;

const safeError = (operation: string) => new StorageError({ operation, message: `Unable to ${operation} accounts data` });
const insecure = (message: string) => new InsecureStorageError({ message });

const validateDirectory = (info: Stats) => {
  if (info.isSymbolicLink() || !info.isDirectory()) throw insecure("Accounts directory is not a regular directory");
  if (POSIX_PERMISSIONS && info.uid !== process.getuid!()) throw insecure("Accounts directory has an unexpected owner");
};

const validatePathBeforeOpen = (info: Stats) => {
  if (info.isSymbolicLink()) throw insecure("Accounts file must not be a symlink");
  if (POSIX_PERMISSIONS && (info.mode & 0o777) !== 0o600) throw insecure("Accounts file has insecure permissions");
};

const validateOpenedFile = (before: Stats, opened: Stats) => {
  if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino)
    throw insecure("Accounts path is not a stable regular file");
  if (POSIX_PERMISSIONS && (opened.mode & 0o777) !== 0o600) throw insecure("Accounts file has insecure permissions");
  if (POSIX_PERMISSIONS && opened.uid !== process.getuid!()) throw insecure("Accounts file has an unexpected owner");
};

const readExact = async (handle: FileHandle, size: number) => {
  const data = Buffer.alloc(size);
  let offset = 0;
  while (offset < data.length) {
    const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset !== data.length) throw new InvalidStateError({ message: "Accounts data changed while reading" });
  return data;
};

export const makeFileStore = (root = defaultAccountsRoot()) => {
  const file = join(root, "accounts.v1.json");
  const locks = join(root, "locks");

  const secureDirectory = async (path: string) => {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    validateDirectory(info);
    if (POSIX_PERMISSIONS) await chmod(path, 0o700);
  };

  const ensureDirs = async () => {
    await secureDirectory(root);
    await secureDirectory(locks);
  };

  const load = async (): Promise<AccountsState> => {
    let handle: FileHandle | undefined;
    try {
      const before = await lstat(file);
      validatePathBeforeOpen(before);

      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = await handle.stat();
      validateOpenedFile(before, opened);

      if (opened.size > MAX_BYTES) throw new InvalidStateError({ message: "Accounts data exceeds the size limit" });
      const data = await readExact(handle, opened.size);

      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString("utf8"));
      } catch {
        throw new InvalidStateError({ message: "Accounts data is not valid JSON" });
      }
      return decodeAccountsState(parsed);
    } catch (error: any) {
      if (error?.code === "ENOENT") return emptyAccountsState();
      if (error instanceof InvalidStateError || error instanceof InsecureStorageError) throw error;
      throw safeError("read");
    } finally {
      await handle?.close().catch(() => undefined);
    }
  };

  const save = async (state: AccountsState): Promise<void> => {
    validateAccountsState(state);
    try {
      await ensureDirs();
    } catch (error) {
      if (error instanceof InsecureStorageError) throw error;
      throw safeError("prepare");
    }

    const temp = join(dirname(file), `.accounts.v1.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
    let handle: FileHandle | undefined;
    try {
      const body = Buffer.from(JSON.stringify(encodeAccountsState(state), null, 2) + "\n");
      if (body.length > MAX_BYTES) throw new InvalidStateError({ message: "Accounts data exceeds the size limit" });

      handle = await open(temp, "wx", 0o600);
      await handle.writeFile(body);
      await handle.sync();
      await handle.close();
      handle = undefined;

      await rename(temp, file);
      if (POSIX_PERMISSIONS) await chmod(file, 0o600);
      try {
        const directory = await open(root, "r");
        await directory.sync();
        await directory.close();
      } catch {
        // Directory sync is not supported on every platform.
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temp).catch(() => undefined);
      if (error instanceof InvalidStateError) throw error;
      throw safeError("write");
    }
  };

  return { root, file, locks, ensureDirs, load, save };
};
