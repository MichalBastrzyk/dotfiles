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

  it("reviews staged changes through a committed snapshot", () => {
    expect(toCodeRabbitArguments(parseReviewRequest("staged --light"))).toEqual([
      "review",
      "--agent",
      "--light",
      "--committed",
    ]);
  });

  it("rejects tracked-only staged reviews", () => {
    expect(() => parseReviewRequest("staged --tracked-only")).toThrow(
      "--tracked-only is redundant with staged reviews.",
    );
  });

  it("supports tracked-only uncommitted reviews", () => {
    expect(toCodeRabbitArguments(parseReviewRequest("uncommitted --tracked-only"))).toEqual([
      "review",
      "--agent",
      "--uncommitted",
    ]);
  });

  it("restricts a review to one folder", () => {
    expect(
      toCodeRabbitArguments(
        parseReviewRequest("uncommitted --dir packages/web --tracked-only --light"),
      ),
    ).toEqual([
      "review",
      "--agent",
      "--light",
      "--dir",
      "packages/web",
      "--uncommitted",
    ]);
  });

  it("requires a folder after --dir", () => {
    expect(() => parseReviewRequest("uncommitted --dir")).toThrow("Missing path after '--dir'.");
  });

  it("rejects more than one folder", () => {
    expect(() => parseReviewRequest("--dir packages/web --dir packages/api")).toThrow(
      "Only one --dir folder can be reviewed at a time.",
    );
  });
});
