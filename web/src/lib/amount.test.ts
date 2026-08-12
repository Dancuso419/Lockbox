import { describe, it, expect } from "vitest";
import { parseHumanAmount, formatBaseUnits } from "./amount";

describe("human amounts", () => {
  it("scales whole and fractional amounts by the asset's decimals", () => {
    expect(parseHumanAmount("5", 18)).toBe(5_000000000000000000n);
    expect(parseHumanAmount("1.5", 18)).toBe(1_500000000000000000n);
    expect(parseHumanAmount("0.5", 18)).toBe(500000000000000000n);
    expect(parseHumanAmount("250", 6)).toBe(250_000000n); // FXRP-style
    expect(parseHumanAmount("0.000001", 6)).toBe(1n);
  });

  it("rejects anything that isn't a positive amount", () => {
    for (const bad of ["", "  ", "0", "0.0", "-1", "abc", "1e18", "1,000", "1.2.3"]) {
      expect(parseHumanAmount(bad, 18)).toBeNull();
    }
  });

  it("refuses more precision than the asset has, rather than truncating", () => {
    // 0.0000001 FXRP (7dp on a 6dp asset) would silently become 0 — the exact
    // failure mode that makes an allocation look fine and pay out nothing.
    expect(parseHumanAmount("0.0000001", 6)).toBeNull();
    expect(parseHumanAmount("1.1234567", 6)).toBeNull();
    expect(parseHumanAmount("1.123456", 6)).toBe(1_123456n);
  });

  it("round-trips back to what the organizer typed", () => {
    const v = parseHumanAmount("2.25", 18)!;
    expect(formatBaseUnits(v, 18)).toBe("2.25");
  });
});
