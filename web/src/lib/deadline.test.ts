import { describe, it, expect } from "vitest";
import { daysToAngle, angleToDays, toLocalInput, daysUntil } from "./deadline";

describe("deadline dial", () => {
  it("maps days to angle and back without drift", () => {
    for (const d of [1, 7, 14, 30, 60, 90]) {
      expect(angleToDays(daysToAngle(d))).toBe(d);
    }
  });

  it("clamps past both ends of the travel", () => {
    expect(daysToAngle(-5)).toBe(daysToAngle(1));
    expect(daysToAngle(400)).toBe(daysToAngle(90));
    expect(angleToDays(-999)).toBe(1);
    expect(angleToDays(999)).toBe(90);
  });

  it("formats for a datetime-local input in LOCAL time, not UTC", () => {
    // A datetime-local value carries no zone, and the form parses it back with
    // `new Date(...)` — so emitting a UTC string would shift the deadline.
    const d = new Date(2026, 7, 20, 9, 5); // 20 Aug 2026, 09:05 local
    expect(toLocalInput(d)).toBe("2026-08-20T09:05");
  });

  it("reads days back out of a value, rounding up", () => {
    const now = new Date(2026, 7, 10, 12, 0).getTime();
    expect(daysUntil("2026-08-17T12:00", now)).toBe(7);
    expect(daysUntil("2026-08-17T18:00", now)).toBe(8); // part-day rounds up
    expect(daysUntil("", now)).toBeNull();
    expect(daysUntil("nonsense", now)).toBeNull();
  });

  it("never reports a deadline shorter than the dial's minimum", () => {
    const now = Date.now();
    expect(daysUntil(new Date(now - 86_400_000).toISOString(), now)).toBe(1);
  });
});
