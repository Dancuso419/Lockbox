/**
 * Challenge string constructors — must byte-match go/internal/extension/extension.go.
 *
 * Go source (handleClaimVerify):
 *   challenge := "ConfidentialPrizePool claim\npool:" + pool.Hex() + "\nkey:" + req.RecipientPubHex + "\nclaim:" + req.ClaimAddress
 *
 * Go source (handleUnclaimedReport):
 *   challenge := "ConfidentialPrizePool unclaimed\npool:" + pool.Hex() + "\nkey:" + req.OrganizerPubHex
 *
 * pool.Hex() in go-ethereum returns checksummed address (EIP-55).
 * RecipientPubHex / OrganizerPubHex are whatever the caller sent (uncompressed 0x04... hex).
 */

/**
 * Challenge string for claim verify.
 * @param pool - Pool address as checksummed hex (e.g. "0xAbc...")
 * @param ephemeralPubHex - Recipient's ephemeral uncompressed pub key hex
 * @param claimAddr - Optional redirect claim address (empty string = not provided)
 */
export function claimChallenge(
  pool: string,
  ephemeralPubHex: string,
  claimAddr = ""
): string {
  return (
    "ConfidentialPrizePool claim\npool:" +
    pool +
    "\nkey:" +
    ephemeralPubHex +
    "\nclaim:" +
    claimAddr
  );
}

/**
 * Challenge string for unclaimed report.
 * @param pool - Pool address as checksummed hex
 * @param organizerPubHex - Organizer's uncompressed pub key hex
 */
export function unclaimedChallenge(pool: string, organizerPubHex: string): string {
  return "ConfidentialPrizePool unclaimed\npool:" + pool + "\nkey:" + organizerPubHex;
}
