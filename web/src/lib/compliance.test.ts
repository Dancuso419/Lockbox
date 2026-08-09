/**
 * verifyCompliance: EIP-712 sign + recover round-trip.
 * Uses a known viem test account as the authorizedSigner.
 */

import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { verifyCompliance } from "./compliance.js";

// Hardhat account #0
const PRIV = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(PRIV);

// Fake pool address
const POOL = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as `0x${string}`;

const DOMAIN = {
  name: "ConfidentialPrizePool",
  version: "1",
  chainId: 114,
  verifyingContract: POOL,
} as const;

const TYPES = {
  ComplianceReport: [
    { name: "pool", type: "address" },
    { name: "totalDeposited", type: "uint256" },
    { name: "totalAllocated", type: "uint256" },
    { name: "recipientCount", type: "uint256" },
  ],
} as const;

// Test values
const totalDeposited = 1000000000000000000n; // 1 ether
const totalAllocated = 900000000000000000n;  // 0.9 ether
const recipientCount = 5n;

async function signReport(
  poolAddr: `0x${string}`,
  dep: bigint,
  alloc: bigint,
  count: bigint
): Promise<`0x${string}`> {
  return account.signTypedData({
    domain: { ...DOMAIN, verifyingContract: poolAddr },
    types: TYPES,
    primaryType: "ComplianceReport",
    message: { pool: poolAddr, totalDeposited: dep, totalAllocated: alloc, recipientCount: count },
  });
}

describe("verifyCompliance", () => {
  it("returns true for a valid signature", async () => {
    const sig = await signReport(POOL, totalDeposited, totalAllocated, recipientCount);
    const ok = await verifyCompliance(
      POOL, totalDeposited, totalAllocated, recipientCount,
      sig, account.address
    );
    expect(ok).toBe(true);
  });

  it("returns false when amount is tampered", async () => {
    const sig = await signReport(POOL, totalDeposited, totalAllocated, recipientCount);
    // tamper: different totalAllocated
    const ok = await verifyCompliance(
      POOL, totalDeposited, totalAllocated + 1n, recipientCount,
      sig, account.address
    );
    expect(ok).toBe(false);
  });

  it("returns false for a wrong authorizedSigner", async () => {
    const sig = await signReport(POOL, totalDeposited, totalAllocated, recipientCount);
    const wrongSigner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`;
    const ok = await verifyCompliance(
      POOL, totalDeposited, totalAllocated, recipientCount,
      sig, wrongSigner
    );
    expect(ok).toBe(false);
  });

  it("returns false for a garbage signature", async () => {
    const garbage = ("0x" + "ab".repeat(65)) as `0x${string}`;
    const ok = await verifyCompliance(
      POOL, totalDeposited, totalAllocated, recipientCount,
      garbage, account.address
    );
    expect(ok).toBe(false);
  });
});
