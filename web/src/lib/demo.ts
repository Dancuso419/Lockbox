/**
 * Demo walkthrough crypto — the landing page's interactive explainer.
 *
 * This is NOT a mock: it runs the same primitives the product runs, in the
 * browser, against a throwaway keypair that stands in for the TEE. The
 * allocation table is really ECIES-sealed (same wire format as the enclave)
 * and the voucher is really ECDSA-signed, so the ciphertext and signature the
 * page shows are genuine bytes, not decoration.
 *
 * ponytail: throwaway in-page keypair instead of talking to the BFF — the
 * landing page must work with no backend. Real flows live in /organizer, /claim.
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak256, encodeAbiParameters, toHex, hexToBytes } from "viem";
import { encryptToTee, decryptWith, newEphemeralKey } from "./ecies";

export type DemoAlloc = { label: string; address: `0x${string}`; amount: bigint };
export type DemoVoucher = { amount: bigint; nonce: `0x${string}`; signature: `0x${string}` };

export { newEphemeralKey };

/** Organizer side: seal the whole allocation table to the enclave's public key. */
export function sealAllocations(teePubHex: string, allocs: DemoAlloc[]): Uint8Array {
  const table = JSON.stringify({
    allocations: allocs.map((a) => ({ recipient: a.address, amount: a.amount.toString() })),
  });
  return encryptToTee(teePubHex, new TextEncoder().encode(table));
}

/**
 * Enclave side: open the sealed table and sign a voucher for ONE recipient.
 * Returns null when the address isn't in the table — the only answer a
 * non-recipient can ever get.
 */
export function issueVoucher(
  teePrivHex: string,
  sealed: Uint8Array,
  recipient: `0x${string}`
): DemoVoucher | null {
  const table = JSON.parse(new TextDecoder().decode(decryptWith(teePrivHex, sealed))) as {
    allocations: { recipient: string; amount: string }[];
  };
  const row = table.allocations.find(
    (r) => r.recipient.toLowerCase() === recipient.toLowerCase()
  );
  if (!row) return null;

  // Random nonce, so the on-chain claim leaks no position in the list.
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const amount = BigInt(row.amount);
  const digest = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }],
      [recipient, amount, nonce]
    )
  );
  const signature = toHex(
    secp256k1.sign(hexToBytes(digest), hexToBytes(teePrivHex as `0x${string}`), {
      prehash: false,
      format: "recovered",
    })
  );
  return { amount, nonce, signature };
}

/** Short middle-elided hex for display. */
export function elide(hex: string, head = 10, tail = 8): string {
  return hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
