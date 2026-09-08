export const PROVIDER_IDS = [
  "openai-codex",
  "opencode-go",
  "cheaper-inference",
] as const;

export type CatalogProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderCatalogEntry {
  readonly name: string;
  readonly shortName: string;
  readonly auth: "oauth" | "api-key";
  readonly dashboardUrl?: string;
  readonly keyPrompt?: string;
  readonly requiredScopes?: string;
}

export const PROVIDERS: Record<CatalogProviderId, ProviderCatalogEntry> = {
  "openai-codex": {
    name: "OpenAI Codex",
    shortName: "OpenAI",
    auth: "oauth",
  },
  "opencode-go": {
    name: "OpenCode Go",
    shortName: "OpenCode",
    auth: "api-key",
    dashboardUrl: "https://opencode.ai/dashboard",
    keyPrompt: "OpenCode API key: ",
    requiredScopes: "usage access",
  },
  "cheaper-inference": {
    name: "CheaperInference",
    shortName: "CheaperInference",
    auth: "api-key",
    dashboardUrl: "https://api.cheaperinference.com/dashboard/keys",
    keyPrompt: "API key: ",
    requiredScopes: "inference + usage:read + account:read",
  },
} as const;

export const isProviderId = (value: unknown): value is CatalogProviderId =>
  typeof value === "string" &&
  (PROVIDER_IDS as readonly string[]).includes(value);

export const providerName = (provider: CatalogProviderId): string =>
  PROVIDERS[provider].name;

export const providerShortName = (provider: CatalogProviderId): string =>
  PROVIDERS[provider].shortName;
