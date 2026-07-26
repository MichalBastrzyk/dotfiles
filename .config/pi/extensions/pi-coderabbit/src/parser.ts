import { Effect, Schema } from "effect";
import type {
  CodeRabbitEvent,
  CompleteEvent,
  ErrorEvent,
  FindingEvent,
  HeartbeatEvent,
  ReviewContextEvent,
  StatusEvent,
  UnknownEvent,
} from "./domain.ts";
import { severities } from "./domain.ts";

const EnvelopeSchema = Schema.Struct({
  type: Schema.String,
});

const FindingSchema = Schema.Struct({
  type: Schema.Literal("finding"),
  severity: Schema.Literals(severities),
  fileName: Schema.String,
  codegenInstructions: Schema.optionalKey(Schema.Unknown),
  suggestions: Schema.optionalKey(Schema.Unknown),
  comment: Schema.optionalKey(Schema.Unknown),
});

const StatusSchema = Schema.Struct({
  type: Schema.Literal("status"),
  status: Schema.optionalKey(Schema.Unknown),
  message: Schema.optionalKey(Schema.Unknown),
});

const CompleteSchema = Schema.Struct({
  type: Schema.Literal("complete"),
  status: Schema.optionalKey(Schema.Unknown),
  findings: Schema.optionalKey(Schema.Unknown),
  message: Schema.optionalKey(Schema.Unknown),
});

const ErrorSchema = Schema.Struct({
  type: Schema.Literal("error"),
  message: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
  candidates: Schema.optionalKey(Schema.Unknown),
  candidatesNote: Schema.optionalKey(Schema.Unknown),
});

const decodeEnvelope = Schema.decodeUnknownSync(EnvelopeSchema);
const decodeFinding = Schema.decodeUnknownSync(FindingSchema);
const decodeStatus = Schema.decodeUnknownSync(StatusSchema);
const decodeComplete = Schema.decodeUnknownSync(CompleteSchema);
const decodeError = Schema.decodeUnknownSync(ErrorSchema);

export class CodeRabbitLineParseError extends Schema.TaggedErrorClass<CodeRabbitLineParseError>()(
  "CodeRabbitLineParseError",
  {
    line: Schema.String,
    reason: Schema.String,
  },
) {}

const reasonOf = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value as Readonly<Record<string, unknown>>;

const asOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asOptionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const stringifyValue = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const asStringArray = (value: unknown): ReadonlyArray<string> => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const text = stringifyValue(item);
      return text === undefined ? [] : [text];
    });
  }
  const text = stringifyValue(value);
  return text === undefined ? [] : [text];
};

const parseJson = (line: string) =>
  Effect.try({
    try: () => JSON.parse(line) as unknown,
    catch: (cause) =>
      new CodeRabbitLineParseError({
        line,
        reason: `Invalid JSON: ${reasonOf(cause)}`,
      }),
  });

const decode = <A>(line: string, label: string, run: (input: unknown) => A, input: unknown) =>
  Effect.try({
    try: () => run(input),
    catch: (cause) =>
      new CodeRabbitLineParseError({
        line,
        reason: `Invalid ${label} event: ${reasonOf(cause)}`,
      }),
  });

export const parseCodeRabbitLine = (
  line: string,
): Effect.Effect<CodeRabbitEvent, CodeRabbitLineParseError> =>
  Effect.gen(function* () {
    const json = yield* parseJson(line);
    const envelope = yield* decode(line, "event envelope", decodeEnvelope, json);
    const raw = asRecord(json);

    switch (envelope.type) {
      case "review_context":
        return {
          type: "review_context",
          raw,
        } satisfies ReviewContextEvent;

      case "status": {
        const event = yield* decode(line, "status", decodeStatus, json);
        return {
          type: "status",
          status: asOptionalString(event.status),
          message: asOptionalString(event.message),
          raw,
        } satisfies StatusEvent;
      }

      case "heartbeat":
        return {
          type: "heartbeat",
          raw,
        } satisfies HeartbeatEvent;

      case "finding": {
        const event = yield* decode(line, "finding", decodeFinding, json);
        return {
          type: "finding",
          severity: event.severity,
          fileName: event.fileName,
          codegenInstructions: asOptionalString(event.codegenInstructions),
          comment: asOptionalString(event.comment),
          suggestions: asStringArray(event.suggestions),
          raw,
        } satisfies FindingEvent;
      }

      case "complete": {
        const event = yield* decode(line, "complete", decodeComplete, json);
        return {
          type: "complete",
          status: asOptionalString(event.status),
          findings: asOptionalNumber(event.findings),
          message: asOptionalString(event.message),
          raw,
        } satisfies CompleteEvent;
      }

      case "error": {
        const event = yield* decode(line, "error", decodeError, json);
        return {
          type: "error",
          message: asOptionalString(event.message) ?? asOptionalString(event.error),
          candidates: asStringArray(event.candidates),
          candidatesNote: asOptionalString(event.candidatesNote),
          raw,
        } satisfies ErrorEvent;
      }

      default:
        return {
          type: "unknown",
          eventType: envelope.type,
          raw,
        } satisfies UnknownEvent;
    }
  });
