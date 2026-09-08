export const MODEL_INFO_CHANNEL = "dashboard:model-info";
export const GIT_INFO_CHANNEL = "dashboard:git-info";
export const REFRESH_CHANNEL = "dashboard:refresh";
export const ACCOUNTS_INFO_CHANNEL = "dashboard:accounts-info";

export interface ModelInfoState {
  provider: string;
  modelId: string;
  modelName: string;
  thinking: string;
  contextTokens: number | null;
  contextWindow: number;
  contextPercent: number | null;
  cost: number;
  tokensPerSecond: number | null;
  generating: boolean;
}

export interface PullRequestInfo {
  number: number;
  url: string;
  isDraft: boolean;
}

export interface GitInfoState {
  isRepository: boolean;
  branch: string | null;
  changedFiles: number;
  pullRequest: PullRequestInfo | null;
}

export function emptyModelInfoState(): ModelInfoState {
  return {
    provider: "",
    modelId: "no-model",
    modelName: "No model",
    thinking: "off",
    contextTokens: null,
    contextWindow: 0,
    contextPercent: null,
    cost: 0,
    tokensPerSecond: null,
    generating: false,
  };
}

export interface AccountUsageWindowInfo { id: string; remaining: number; resetsAt: number | null }
export interface AccountUsageSummaryInfo {
  spendUsd?: number;
  spendUsdToday?: number;
  requests?: number;
  availableUsd?: number;
}
export interface AccountProviderUsageInfo {
  provider: string;
  accountId: string;
  label: string;
  active: boolean;
  plan: string | null;
  windows: AccountUsageWindowInfo[];
  summary?: AccountUsageSummaryInfo | null;
}

export function emptyGitInfoState(): GitInfoState {
  return {
    isRepository: false,
    branch: null,
    changedFiles: 0,
    pullRequest: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown) {
  return value === null || isFiniteNumber(value);
}

export function isModelInfoState(value: unknown): value is ModelInfoState {
  if (!isRecord(value)) return false;

  return (
    typeof value.provider === "string" &&
    typeof value.modelId === "string" &&
    typeof value.modelName === "string" &&
    typeof value.thinking === "string" &&
    isNullableNumber(value.contextTokens) &&
    isFiniteNumber(value.contextWindow) &&
    isNullableNumber(value.contextPercent) &&
    isFiniteNumber(value.cost) &&
    isNullableNumber(value.tokensPerSecond) &&
    typeof value.generating === "boolean"
  );
}

const isSummaryInfo = (value: unknown): value is AccountUsageSummaryInfo => {
  if (value === null || value === undefined) return true;
  if (!isRecord(value)) return false;
  const { spendUsd, spendUsdToday, requests, availableUsd } = value as Record<string, unknown>;
  return (
    (spendUsd === undefined || isFiniteNumber(spendUsd)) &&
    (spendUsdToday === undefined || isFiniteNumber(spendUsdToday)) &&
    (requests === undefined || isFiniteNumber(requests)) &&
    (availableUsd === undefined || isFiniteNumber(availableUsd))
  );
};
export function isAccountsInfoState(value: unknown): value is AccountProviderUsageInfo[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!isRecord(item)) return false;
    return (
      typeof item.provider === "string" &&
      typeof item.accountId === "string" &&
      typeof item.label === "string" &&
      typeof item.active === "boolean" &&
      (item.plan === null || typeof item.plan === "string") &&
      Array.isArray(item.windows) &&
      item.windows.every((window) => isRecord(window) && typeof window.id === "string" && isFiniteNumber(window.remaining) && (window.resetsAt === null || isFiniteNumber(window.resetsAt))) &&
      (item.summary === undefined || isSummaryInfo(item.summary))
    );
  });
}

export function isPullRequestInfo(value: unknown): value is PullRequestInfo {
  if (!isRecord(value)) return false;

  return (
    isFiniteNumber(value.number) &&
    Number.isInteger(value.number) &&
    value.number > 0 &&
    typeof value.url === "string" &&
    typeof value.isDraft === "boolean"
  );
}

export function isGitInfoState(value: unknown): value is GitInfoState {
  if (!isRecord(value)) return false;

  return (
    typeof value.isRepository === "boolean" &&
    (value.branch === null || typeof value.branch === "string") &&
    isFiniteNumber(value.changedFiles) &&
    Number.isInteger(value.changedFiles) &&
    value.changedFiles >= 0 &&
    (value.pullRequest === null || isPullRequestInfo(value.pullRequest))
  );
}
