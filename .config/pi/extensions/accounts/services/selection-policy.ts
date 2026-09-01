import type { AccountsState, ProviderId } from "../domain.ts";
import type { SessionService } from "./session-service.ts";

/** Deliberately manual: account usage never changes routing. */
export interface AccountSelectionPolicy { select(provider: ProviderId): string | undefined }
export const makeAccountSelectionPolicy = (session: SessionService, state: AccountsState): AccountSelectionPolicy => ({
  select: (provider) => session.get(provider) ?? state.providers[provider].defaultAccount,
});
