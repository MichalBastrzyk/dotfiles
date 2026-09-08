import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CheaperInferencePiModel } from "../providers/cheaper-inference-models.ts";

const CACHE_VERSION = 1;
const FILE_NAME = "cheaper-inference-models.json";

interface ModelCacheFile {
  version: number;
  updatedAt: number;
  models: CheaperInferencePiModel[];
}

const isCachedModel = (value: unknown): value is CheaperInferencePiModel =>
  !!value &&
  typeof value === "object" &&
  typeof (value as { id?: unknown }).id === "string" &&
  ((value as { id: string }).id.length > 0);

/** Accounts-owned catalog cache so fresh processes resolve CI models before any session sync. Best-effort: corrupt/missing cache reads as []. */
export const readModelCache = async (root: string): Promise<CheaperInferencePiModel[]> => {
  try {
    const parsed = JSON.parse(await readFile(join(root, FILE_NAME), "utf8")) as Partial<ModelCacheFile>;
    if (parsed?.version !== CACHE_VERSION || !Array.isArray(parsed.models)) return [];
    return parsed.models.filter(isCachedModel);
  } catch {
    return [];
  }
};

export const writeModelCache = async (root: string, models: CheaperInferencePiModel[]): Promise<void> => {
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const file: ModelCacheFile = { version: CACHE_VERSION, updatedAt: Date.now(), models };
    await writeFile(join(root, FILE_NAME), JSON.stringify(file), { mode: 0o600 });
  } catch {
    // Cache is an optimization; the live API remains the source of truth.
  }
};
