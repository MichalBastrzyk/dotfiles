import { Schema } from "effect";
import type { ReviewRequest } from "./domain.ts";

export class InvalidReviewArguments extends Schema.TaggedErrorClass<InvalidReviewArguments>()(
  "InvalidReviewArguments",
  {
    message: Schema.String,
  },
) {}

export const usage = [
  "/cr",
  "/cr uncommitted",
  "/cr committed",
  "/cr all",
  "/cr base <branch>",
  "",
  "Optional flags:",
  "  --light          Request the lighter review policy",
  "  --tracked-only   Exclude untracked files",
].join("\n");

const tokenize = (input: string): ReadonlyArray<string> =>
  input
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 0);

export const parseReviewRequest = (input: string): ReviewRequest => {
  const tokens = [...tokenize(input)];
  const lightIndex = tokens.indexOf("--light");
  const light = lightIndex !== -1;
  if (light) tokens.splice(lightIndex, 1);

  const trackedOnlyIndex = tokens.indexOf("--tracked-only");
  const trackedOnly = trackedOnlyIndex !== -1;
  if (trackedOnly) tokens.splice(trackedOnlyIndex, 1);

  if (tokens.some((token) => token.startsWith("--"))) {
    throw new InvalidReviewArguments({
      message: `Unknown option.\n\n${usage}`,
    });
  }

  const includeUntracked = !trackedOnly;
  const [scope = "uncommitted", branch, ...extra] = tokens;

  if (extra.length > 0) {
    throw new InvalidReviewArguments({
      message: `Too many arguments.\n\n${usage}`,
    });
  }

  switch (scope) {
    case "uncommitted":
      return {
        light,
        scope: { kind: "uncommitted", includeUntracked },
      };

    case "committed":
      if (trackedOnly) {
        throw new InvalidReviewArguments({
          message: "--tracked-only is redundant with committed reviews.",
        });
      }
      return {
        light,
        scope: { kind: "committed" },
      };

    case "all":
      return {
        light,
        scope: { kind: "all", includeUntracked },
      };

    case "base":
      if (branch === undefined || branch.length === 0) {
        throw new InvalidReviewArguments({
          message: `Missing branch after 'base'.\n\n${usage}`,
        });
      }
      return {
        light,
        scope: { kind: "base", branch, includeUntracked },
      };

    default:
      throw new InvalidReviewArguments({
        message: `Unknown review scope '${scope}'.\n\n${usage}`,
      });
  }
};

export const toCodeRabbitArguments = (request: ReviewRequest): ReadonlyArray<string> => {
  const args = ["review", "--agent"];

  if (request.light) args.push("--light");

  switch (request.scope.kind) {
    case "uncommitted":
      args.push("--uncommitted");
      if (request.scope.includeUntracked) args.push("--include-untracked");
      break;

    case "committed":
      args.push("--committed");
      break;

    case "all":
      if (request.scope.includeUntracked) args.push("--include-untracked");
      break;

    case "base":
      args.push("--base", request.scope.branch);
      if (request.scope.includeUntracked) args.push("--include-untracked");
      break;
  }

  return args;
};
