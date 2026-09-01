import { Schema } from "effect";
import { AccountsState, InvalidStateError, type AccountsState as State } from "../domain.ts";

const decode = Schema.decodeUnknownSync(AccountsState);
const encode = Schema.encodeSync(AccountsState);

export const decodeAccountsState = (value: unknown): State => {
  try {
    return decode(value);
  } catch {
    throw new InvalidStateError({ message: "Accounts data is invalid or has an unsupported version" });
  }
};

export const validateAccountsState = (value: unknown): State => decodeAccountsState(value);
export const encodeAccountsState = (value: State): unknown => {
  try {
    return encode(value);
  } catch {
    throw new InvalidStateError({ message: "Accounts state is invalid" });
  }
};
