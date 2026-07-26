import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { parseCodeRabbitLine } from "../src/parser.ts";

const parse = (line: string) => Effect.runPromise(parseCodeRabbitLine(line));

describe("parseCodeRabbitLine", () => {
  it("parses a finding and keeps additive fields forward-compatible", async () => {
    const event = await parse(
      JSON.stringify({
        type: "finding",
        severity: "major",
        fileName: "src/auth.ts",
        codegenInstructions: "Validate the token before using it.",
        suggestions: ["Add an explicit expiry check"],
        futureField: { enabled: true },
      }),
    );

    expect(event.type).toBe("finding");
    if (event.type !== "finding") throw new Error("expected finding");
    expect(event.severity).toBe("major");
    expect(event.fileName).toBe("src/auth.ts");
    expect(event.suggestions).toEqual(["Add an explicit expiry check"]);
    expect(event.raw.futureField).toEqual({ enabled: true });
  });

  it("falls back to the human comment when codegen instructions are empty", async () => {
    const event = await parse(
      JSON.stringify({
        type: "finding",
        severity: "minor",
        fileName: "src/api.ts",
        codegenInstructions: "",
        comment: "The failure path is not handled.",
      }),
    );

    expect(event.type).toBe("finding");
    if (event.type !== "finding") throw new Error("expected finding");
    expect(event.codegenInstructions).toBeUndefined();
    expect(event.comment).toBe("The failure path is not handled.");
  });

  it("parses a skipped completion event", async () => {
    const event = await parse(
      JSON.stringify({
        type: "complete",
        status: "review_skipped",
        findings: 0,
        message: "No changes detected",
      }),
    );

    expect(event).toMatchObject({
      type: "complete",
      status: "review_skipped",
      findings: 0,
      message: "No changes detected",
    });
  });

  it("preserves unknown additive event types without failing", async () => {
    const event = await parse(JSON.stringify({ type: "future_event", value: 42 }));
    expect(event).toMatchObject({ type: "unknown", eventType: "future_event" });
  });

  it("rejects non-JSON lines", async () => {
    await expect(parse("not json")).rejects.toMatchObject({
      _tag: "CodeRabbitLineParseError",
    });
  });
});
