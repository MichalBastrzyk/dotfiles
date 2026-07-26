import { describe, expect, it } from "vitest";
import { parseReviewRequest, toCodeRabbitArguments } from "../src/args.ts";

describe("CodeRabbit arguments", () => {
  it("defaults to uncommitted changes including untracked files", () => {
    expect(toCodeRabbitArguments(parseReviewRequest(""))).toEqual([
      "review",
      "--agent",
      "--uncommitted",
      "--include-untracked",
    ]);
  });

  it("builds a base review without shell interpolation", () => {
    expect(toCodeRabbitArguments(parseReviewRequest("base develop --light"))).toEqual([
      "review",
      "--agent",
      "--light",
      "--base",
      "develop",
      "--include-untracked",
    ]);
  });

  it("supports tracked-only uncommitted reviews", () => {
    expect(toCodeRabbitArguments(parseReviewRequest("uncommitted --tracked-only"))).toEqual([
      "review",
      "--agent",
      "--uncommitted",
    ]);
  });
});
