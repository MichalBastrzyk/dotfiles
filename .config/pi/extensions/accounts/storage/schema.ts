import { Schema } from "effect";
import {
  AccountsState,
  AccountsStateV1,
  InvalidStateError,
  migrateV1ToV2,
  type AccountsState as State,
} from "../domain.ts";

const decodeV2 = Schema.decodeUnknownSync(AccountsState);
const decodeV1 = Schema.decodeUnknownSync(AccountsStateV1);
const encode = Schema.encodeSync(AccountsState);

export const decodeAccountsState = (value: unknown): State => {
  try {
    return decodeV2(value);
  } catch {
    try {
      return migrateV1ToV2(decodeV1(value));
    } catch {
      throw new InvalidStateError({
        message: "Accounts data is invalid or has an unsupported version",
      });
    }
  }
};

export const validateAccountsState = (value: unknown): State =>
  decodeAccountsState(value);
export const encodeAccountsState = (value: State): unknown => {
  try {
    return encode(value);
  } catch {
    throw new InvalidStateError({ message: "Accounts state is invalid" });
  }
};
