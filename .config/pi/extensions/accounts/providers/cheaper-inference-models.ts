import { CHEAPER_INFERENCE_MODELS_URL } from "./cheaper-inference.ts";

export interface CheaperInferencePiModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  compat: {
    supportsStore: false;
    supportsDeveloperRole: false;
    maxTokensField: "max_tokens";
  };
}

const toRate = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const toInt = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const readField = (entry: Record<string, any>, ...names: string[]): unknown => {
  for (const name of names) {
    const value = entry[name];
    if (value !== undefined && value !== null) return value;
  }
  const nested = entry.pricing;
  if (nested && typeof nested === "object") {
    for (const name of names) {
      const value = (nested as Record<string, unknown>)[name];
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
};

/** Map one catalog entry (flat `/public` shape or nested `/v1` shape) to a Pi model. Returns undefined when unusable for chat. */
export const mapCheaperInferenceModel = (entry: unknown): CheaperInferencePiModel | undefined => {
  if (!entry || typeof entry !== "object") return undefined;
  const item = entry as Record<string, any>;
  const id = item.id;
  if (typeof id !== "string" || id.length === 0) return undefined;

  const type = item.model_type ?? item.type;
  if (type !== undefined && type !== "text") return undefined;

  const capabilities = item.capabilities;
  const caps = capabilities && typeof capabilities === "object" ? capabilities : {};
  const reasoning =
    item.supports_reasoning ?? caps.reasoning ?? caps.supports_reasoning ?? false;
  const vision = item.supports_vision ?? caps.vision ?? caps.supports_vision ?? false;

  return {
    id,
    name: id,
    reasoning: reasoning === true,
    input: vision === true ? ["text", "image"] : ["text"],
    cost: {
      input: toRate(readField(item, "input_per_million")),
      output: toRate(readField(item, "output_per_million")),
      cacheRead: toRate(readField(item, "cache_read_per_million", "cache_read_input_per_million")),
      cacheWrite: toRate(
        readField(item, "cache_write_per_million", "cache_write_input_per_million"),
      ),
    },
    contextWindow: toInt(item.context_length, 128000),
    maxTokens: toInt(item.max_output_tokens, 16384),
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
    },
  };
};

export const mapCheaperInferenceCatalog = (data: unknown): CheaperInferencePiModel[] => {
  const list = Array.isArray(data)
    ? data
    : (data as { data?: unknown })?.data;
  if (!Array.isArray(list)) return [];
  return list
    .map(mapCheaperInferenceModel)
    .filter((model): model is CheaperInferencePiModel => model !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

export const credentialKeyOf = (credential: unknown): string | undefined => {
  if (!credential || typeof credential !== "object") return undefined;
  const entry = credential as { type?: unknown; key?: unknown };
  return entry.type === "api_key" && typeof entry.key === "string" && entry.key.length > 0
    ? entry.key
    : undefined;
};

export const fetchCheaperInferenceModels = async ({
  key,
  fetcher = fetch,
  signal,
}: {
  key: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<CheaperInferencePiModel[]> => {
  const response = await fetcher(CHEAPER_INFERENCE_MODELS_URL, {
    headers: { Authorization: `Bearer ${key}` },
    redirect: "error",
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("CheaperInference credentials were rejected");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`CheaperInference catalog returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  return mapCheaperInferenceCatalog(payload);
};
