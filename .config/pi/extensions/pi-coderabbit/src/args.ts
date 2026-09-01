import { Schema } from "effect";
import type { ReviewRequest } from "./domain.ts";

export class InvalidReviewArguments extends Schema.TaggedError<InvalidReviewArguments>()(
  "InvalidReviewArguments",
  {
    message: Schema.String,
  },
) {}

export const usage = [
  "/cr",
  "/cr uncommitted",
  "/cr staged",
  "/cr committed",
  "/cr all",
  "/cr base <branch>",
  "",
  "Optional flags:",
  "  --dir <path>     Restrict the review to one folder",
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

  const directoryIndex = tokens.indexOf("--dir");
  const directory = directoryIndex === -1 ? undefined : tokens[directoryIndex + 1];
  if (directoryIndex !== -1) {
    if (directory === undefined || directory.startsWith("--")) {
      throw new InvalidReviewArguments({
        message: `Missing path after '--dir'.\n\n${usage}`,
      });
    }
    tokens.splice(directoryIndex, 2);
  }
  if (tokens.includes("--dir")) {
    throw new InvalidReviewArguments({
      message: "Only one --dir folder can be reviewed at a time.",
    });
  }

  if (tokens.some((token) => token.startsWith("--"))) {
    throw new InvalidReviewArguments({
      message: `Unknown option.\n\n${usage}`,
    });
  }

  const includeUntracked = !trackedOnly;
  const options = { light, directory };
  const [scope = "uncommitted", branch, ...extra] = tokens;

  if (extra.length > 0) {
    throw new InvalidReviewArguments({
      message: `Too many arguments.\n\n${usage}`,
    });
  }

  switch (scope) {
    case "uncommitted":
      return {
        ...options,
        scope: { kind: "uncommitted", includeUntracked },
      };

    case "staged":
    case "committed":
      if (trackedOnly) {
        throw new InvalidReviewArguments({
          message: `--tracked-only is redundant with ${scope} reviews.`,
        });
      }
      return {
        ...options,
        scope: { kind: scope },
      };

    case "all":
      return {
        ...options,
        scope: { kind: "all", includeUntracked },
      };

    case "base":
      if (branch === undefined || branch.length === 0) {
        throw new InvalidReviewArguments({
          message: `Missing branch after 'base'.\n\n${usage}`,
        });
      }
      return {
        ...options,
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
  if (request.directory) args.push("--dir", request.directory);

  switch (request.scope.kind) {
    case "uncommitted":
      args.push("--uncommitted");
      if (request.scope.includeUntracked) args.push("--include-untracked");
      break;

    case "staged":
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
