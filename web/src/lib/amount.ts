import { parseUnits, formatUnits } from "viem";

/**
 * Amounts the organizer types are human ones — "5" means five C2FLR, the way it
 * does everywhere else in the app. The enclave and the contract work in base
 * units, so the conversion happens here, once, instead of being asked of the
 * person filling in the form. Getting this wrong is expensive in a way a typo
 * usually isn't: "5" read as base units allocates 5 wei, which looks like a
 * successful allocation and pays out nothing.
 */

/** Human amount → base units. Null when the text isn't a usable amount. */
export function parseHumanAmount(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;

  // More decimal places than the asset has would be silently truncated, and a
  // silently smaller allocation is exactly the failure this module exists to
  // prevent — so refuse it instead.
  const frac = t.split(".")[1] ?? "";
  if (frac.length > decimals) return null;

  const value = parseUnits(t, decimals);
  return value > 0n ? value : null;
}

/** Base units → human string, for echoing back what will actually be sent. */
export function formatBaseUnits(value: bigint, decimals: number): string {
  return formatUnits(value, decimals);
}
