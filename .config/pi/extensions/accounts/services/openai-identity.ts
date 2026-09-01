import { InvalidAccountError, type OpenAIAccount } from "../domain.ts";

type Claims = Record<string, unknown>;

const nonEmptyString = (value: unknown) => typeof value === "string" && value ? value : undefined;
const claim = (claims: Claims, namespace: string, name: string) => {
  const value = claims[namespace];
  return value !== null && typeof value === "object"
    ? nonEmptyString((value as Record<string, unknown>)[name])
    : undefined;
};

/** Returns the stable workspace/user identity encoded in an OpenAI OAuth credential. */
export const openAIIdentity = (credential: OpenAIAccount["credential"]): string => {
  try {
    const claims: unknown = JSON.parse(Buffer.from(credential.access.split(".")[1] ?? "", "base64url").toString("utf8"));
    if (claims === null || typeof claims !== "object" || Array.isArray(claims)) throw new Error("claims");

    const workspace = claim(claims as Claims, "https://api.openai.com/auth", "chatgpt_account_id") ?? credential.accountId;
    const user = claim(claims as Claims, "https://api.openai.com/profile", "email") ?? nonEmptyString((claims as Claims).sub);
    if (!workspace || !user) throw new Error("identity");
    return `${workspace}/${user}`;
  } catch {
    throw new InvalidAccountError({ message: "OpenAI account identity is invalid" });
  }
};
