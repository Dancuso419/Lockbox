/**
 * Bidirectional ECIES interop test: TS <-> Go eciesharness.exe
 * Fixed private key: ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { encryptToTee, decryptWith } from "./ecies.js";

const PRIV = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const HARNESS = "../bin/eciesharness.exe";

function run(args: string[]): string {
  return execFileSync(HARNESS, args, { encoding: "utf8" }).trim();
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const padded = h.length % 2 ? "0" + h : h;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return "0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

describe("ECIES interop: TS <-> Go", () => {
  const goPub = run(["pub", PRIV]);

  it("TS encrypt -> Go decrypt", () => {
    const msg = new TextEncoder().encode("hello from TypeScript");
    const ct = encryptToTee(goPub, msg);
    const ctHex = bytesToHex(ct);
    const plainHex = run(["dec", PRIV, ctHex]);
    const recovered = new TextDecoder().decode(hexToBytes(plainHex));
    expect(recovered).toBe("hello from TypeScript");
  });

  it("Go encrypt -> TS decrypt", () => {
    const msg = new TextEncoder().encode("hello from Go");
    const msgHex = bytesToHex(msg);
    const ctHex = run(["enc", goPub, msgHex]);
    const ct = hexToBytes(ctHex);
    const plain = decryptWith("0x" + PRIV, ct);
    expect(new TextDecoder().decode(plain)).toBe("hello from Go");
  });

  it("Go encrypt -> TS decrypt (binary round-trip)", () => {
    // Test with non-ASCII bytes to ensure binary correctness
    const original = new Uint8Array([0, 1, 2, 255, 128, 64, 32]);
    const msgHex = bytesToHex(original);
    const ctHex = run(["enc", goPub, msgHex]);
    const ct = hexToBytes(ctHex);
    const plain = decryptWith("0x" + PRIV, ct);
    expect(plain).toEqual(original);
  });
});
