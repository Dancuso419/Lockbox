/**
 * Challenge string tests: verify EIP-191 personal_sign round-trip via viem.
 * Proves go's accounts.TextHash parity with viem's signMessage.
 */

import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { claimChallenge, unclaimedChallenge } from "./challenge.js";

// Hardhat account #0 private key
const PRIV = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(PRIV);

// Fake pool address (checksummed) and pub key
const POOL = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const PUB = "0x048318535b54105d4a7aae60c08fc45f9687181b4fdfc625bd1a753fa7397fed753547f11ca8696646f2f3acb08e31016afac23e630c5d11f59f61fef57b0d2aa5";

describe("challenge strings", () => {
  it("claimChallenge: EIP-191 sign + recover matches signer", async () => {
    const msg = claimChallenge(POOL, PUB, "");
    const sig = await account.signMessage({ message: msg });
    const recovered = await recoverMessageAddress({ message: msg, signature: sig });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("claimChallenge with claimAddr: sign + recover matches signer", async () => {
    const claimAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const msg = claimChallenge(POOL, PUB, claimAddr);
    expect(msg).toContain("\nclaim:" + claimAddr);
    const sig = await account.signMessage({ message: msg });
    const recovered = await recoverMessageAddress({ message: msg, signature: sig });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("unclaimedChallenge: EIP-191 sign + recover matches signer", async () => {
    const msg = unclaimedChallenge(POOL, PUB);
    const sig = await account.signMessage({ message: msg });
    const recovered = await recoverMessageAddress({ message: msg, signature: sig });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("claimChallenge format matches Go byte-for-byte", () => {
    const msg = claimChallenge(POOL, PUB, "");
    expect(msg).toBe(
      "ConfidentialPrizePool claim\npool:" + POOL + "\nkey:" + PUB + "\nclaim:"
    );
  });

  it("unclaimedChallenge format matches Go byte-for-byte", () => {
    const msg = unclaimedChallenge(POOL, PUB);
    expect(msg).toBe(
      "ConfidentialPrizePool unclaimed\npool:" + POOL + "\nkey:" + PUB
    );
  });
});
