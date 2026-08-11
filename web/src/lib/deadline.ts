/**
 * Dial maths for the deadline control. Kept apart from the view so the mapping
 * can be tested on its own — and because what it computes (a timestamp the
 * contract will enforce) deserves to be checkable without rendering anything.
 */

export const MIN_DAYS = 1;
export const MAX_DAYS = 90;
export const SWEEP = 300; // degrees of travel, leaving a gap at the bottom
export const START = -150; // 0° is straight up

export const PRESETS = [7, 14, 30, 60] as const;

/** Days → dial angle in degrees, 0° being straight up. */
export function daysToAngle(days: number): number {
  const clamped = Math.min(MAX_DAYS, Math.max(MIN_DAYS, days));
  return START + ((clamped - MIN_DAYS) / (MAX_DAYS - MIN_DAYS)) * SWEEP;
}

/** Dial angle → whole days, clamped to the dial's range. */
export function angleToDays(angle: number): number {
  const t = (angle - START) / SWEEP;
  return Math.round(MIN_DAYS + Math.min(1, Math.max(0, t)) * (MAX_DAYS - MIN_DAYS));
}

/** A Date as the local `YYYY-MM-DDTHH:mm` a datetime-local input expects. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** Whole days from now until `value`, rounded up; null when unset/invalid. */
export function daysUntil(value: string, now = Date.now()): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(MIN_DAYS, Math.ceil((ms - now) / 86_400_000));
}
