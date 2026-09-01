import type { ProviderId } from "../domain.ts";

/**
 * ASCII art provider logos rendered above each group header in /accounts
 * (always shown, even when the group has no accounts). Font: figlet "smblock".
 *
 * To swap in other art: keep each logo <= 30 columns wide and <= 5 lines tall.
 * Generator: https://patorjk.com/software/taag (font: "smblock")
 */
export const PROVIDER_ART: Readonly<Record<ProviderId, readonly string[]>> = {
  "openai-codex": [
    "▞▀▖         ▞▀▖▜▘",
    "▌ ▌▛▀▖▞▀▖▛▀▖▙▄▌▐ ",
    "▌ ▌▙▄▘▛▀ ▌ ▌▌ ▌▐ ",
    "▝▀ ▌  ▝▀▘▘ ▘▘ ▘▀▘",
  ],
  "opencode-go": [
    "                    ▌   ",
    "▞▀▖▛▀▖▞▀▖▛▀▖▞▀▖▞▀▖▞▀▌▞▀▖",
    "▌ ▌▙▄▘▛▀ ▌ ▌▌ ▖▌ ▌▌ ▌▛▀ ",
    "▝▀ ▌  ▝▀▘▘ ▘▝▀ ▝▀ ▝▀▘▝▀▘",
  ],
};
