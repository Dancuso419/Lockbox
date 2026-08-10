import { describe, it, expect } from "vitest";
import { getAddress } from "viem";
import { sealAllocations, issueVoucher, newEphemeralKey, type DemoAlloc } from "./demo";

// Mixed-case checksummed address included on purpose: viem's ABI encoder
// rejects an address whose EIP-55 checksum doesn't match.
const ALLOCS: DemoAlloc[] = [
  { label: "A", address: getAddress("0xa11ce0000000000000000000000000000000a11c"), amount: 500n },
  { label: "B", address: "0x2222222222222222222222222222222222222222", amount: 300n },
  { label: "C", address: "0x3333333333333333333333333333333333333333", amount: 200n },
];

describe("landing demo", () => {
  const tee = newEphemeralKey();
  const sealed = sealAllocations(tee.pubHex, ALLOCS);

  it("seals the table so the amounts never appear in the wire bytes", () => {
    const wire = new TextDecoder().decode(sealed);
    for (const a of ALLOCS) expect(wire).not.toContain(a.amount.toString());
  });

  it("releases exactly the caller's own amount", () => {
    for (const a of ALLOCS) {
      expect(issueVoucher(tee.privHex, sealed, a.address)?.amount).toBe(a.amount);
    }
  });

  it("gives a non-recipient nothing", () => {
    expect(
      issueVoucher(tee.privHex, sealed, "0x9999999999999999999999999999999999999999")
    ).toBeNull();
  });

  it("issues a distinct nonce and a 65-byte recoverable signature", () => {
    const v1 = issueVoucher(tee.privHex, sealed, ALLOCS[0].address)!;
    const v2 = issueVoucher(tee.privHex, sealed, ALLOCS[0].address)!;
    expect(v1.nonce).not.toBe(v2.nonce);
    expect(v1.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });
});
