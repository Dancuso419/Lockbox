import { hashTypedData, recoverAddress } from "viem";

const DOMAIN = {
  name: "ConfidentialPrizePool",
  version: "1",
  chainId: 114,
} as const;

const TYPES = {
  ComplianceReport: [
    { name: "pool", type: "address" },
    { name: "totalDeposited", type: "uint256" },
    { name: "totalAllocated", type: "uint256" },
    { name: "recipientCount", type: "uint256" },
  ],
} as const;

/**
 * Verify a TEE-signed compliance report via EIP-712.
 * The authorizedSigner field from on-chain pool state is the expected signer.
 */
export async function verifyCompliance(
  pool: `0x${string}`,
  totalDeposited: bigint,
  totalAllocated: bigint,
  recipientCount: bigint,
  signature: `0x${string}`,
  authorizedSigner: `0x${string}`
): Promise<boolean> {
  try {
    const hash = hashTypedData({
      domain: { ...DOMAIN, verifyingContract: pool },
      types: TYPES,
      primaryType: "ComplianceReport",
      message: { pool, totalDeposited, totalAllocated, recipientCount },
    });
    const recovered = await recoverAddress({ hash, signature });
    return recovered.toLowerCase() === authorizedSigner.toLowerCase();
  } catch {
    return false;
  }
}
