// SPDX-License-Identifier: Apache-2.0
/**
 * Shared USD formatting for the running-cost displays. Both the in-page
 * widget tray and the dock's per-conversation cost chip render the same
 * dollar amounts, and used to carry byte-identical private copies of
 * this logic (each commented "mirrors the other"). Centralising it here
 * means the two surfaces can never drift on how a cost reads.
 *
 * Sub-cent amounts render at 4-decimal precision so a string of cheap
 * turns still surfaces a non-zero badge; >= $0.01 trims to two decimals.
 * Callers gate on `cost > 0`, so this never has to render "$0".
 */
export function formatCompactUsd(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
