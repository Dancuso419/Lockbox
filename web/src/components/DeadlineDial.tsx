import { useRef, useState } from "react";
import {
  MIN_DAYS,
  MAX_DAYS,
  SWEEP,
  START,
  PRESETS,
  daysToAngle,
  angleToDays,
  toLocalInput,
  daysUntil,
} from "@/lib/deadline";

/**
 * DeadlineDial — the deadline is set by turning a vault dial, because what an
 * organizer actually decides is "how long do they have", not "which calendar
 * square". The absolute timestamp is shown underneath, and an exact field is
 * one click away for the cases where a specific instant matters.
 */

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Arc path from the dial's start to `angle`. */
function arc(cx: number, cy: number, r: number, to: number) {
  const a = polar(cx, cy, r, START);
  const b = polar(cx, cy, r, to);
  const large = to - START > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

export default function DeadlineDial({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const [exact, setExact] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const days = daysUntil(value) ?? 14;
  const angle = daysToAngle(days);

  function commitDays(d: number) {
    const target = new Date();
    target.setDate(target.getDate() + d);
    onChange(toLocalInput(target));
  }

  /** Pointer position → days, via the angle from the dial's centre. */
  function pointerToDays(e: PointerEvent | React.PointerEvent) {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90; // 0° = up
    if (deg > 180) deg -= 360;
    // Ignore the dead zone at the bottom rather than snapping across it.
    if (deg < START || deg > START + SWEEP) return null;
    return angleToDays(deg);
  }

  function startDrag(e: React.PointerEvent) {
    const first = pointerToDays(e);
    if (first != null) commitDays(first);
    const move = (ev: PointerEvent) => {
      const d = pointerToDays(ev);
      if (d != null) commitDays(d);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 7 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      commitDays(Math.min(MAX_DAYS, days + step));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      commitDays(Math.max(MIN_DAYS, days - step));
    } else if (e.key === "Home") {
      e.preventDefault();
      commitDays(MIN_DAYS);
    } else if (e.key === "End") {
      e.preventDefault();
      commitDays(MAX_DAYS);
    }
  }

  const cx = 90;
  const cy = 90;
  const knob = polar(cx, cy, 58, angle);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-8">
        <svg
          ref={svgRef}
          viewBox="0 0 180 180"
          className="size-[180px] shrink-0 cursor-grab touch-none select-none active:cursor-grabbing focus:outline-none"
          role="slider"
          tabIndex={0}
          aria-label="Deadline, in days from now"
          aria-valuemin={MIN_DAYS}
          aria-valuemax={MAX_DAYS}
          aria-valuenow={value ? days : undefined}
          aria-valuetext={value ? `${days} ${days === 1 ? "day" : "days"}` : "not set"}
          onPointerDown={startDrag}
          onKeyDown={onKeyDown}
        >
          <defs>
            <linearGradient id="dd-face" x1="0.25" y1="0" x2="0.75" y2="1">
              <stop offset="0%" stopColor="var(--metal-hi)" />
              <stop offset="45%" stopColor="var(--metal-mid)" />
              <stop offset="100%" stopColor="var(--metal-lo)" />
            </linearGradient>
          </defs>

          {/* travel + filled portion */}
          <path d={arc(cx, cy, 74, START + SWEEP)} fill="none" stroke="var(--border-strong)" strokeWidth="2" />
          {value && (
            <path
              d={arc(cx, cy, 74, angle)}
              fill="none"
              stroke="var(--glow)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          )}

          {/* graduations */}
          {Array.from({ length: 31 }).map((_, i) => {
            const deg = START + (i / 30) * SWEEP;
            const major = i % 5 === 0;
            const a = polar(cx, cy, major ? 62 : 65, deg);
            const b = polar(cx, cy, 68, deg);
            return (
              <path
                key={i}
                d={`M${a.x} ${a.y} L${b.x} ${b.y}`}
                stroke="currentColor"
                className="text-muted-foreground"
                strokeOpacity={major ? 0.55 : 0.3}
                strokeWidth={major ? 1.6 : 1}
              />
            );
          })}

          {/* the wheel */}
          <circle cx={cx} cy={cy} r="52" fill="url(#dd-face)" stroke="var(--border-strong)" />
          <circle cx={cx} cy={cy - 1} r="52" fill="none" stroke="var(--border)" />
          <circle cx={cx} cy={cy} r="44" fill="none" stroke="var(--border)" />

          {/* grip notch that follows the value */}
          <circle cx={knob.x} cy={knob.y} r="7" fill="var(--glow)" />
          <circle cx={knob.x} cy={knob.y} r="7" fill="none" stroke="var(--border-strong)" />

          <text
            x={cx}
            y={cy + 2}
            textAnchor="middle"
            className="fill-foreground"
            fontFamily="var(--font-mono)"
            fontSize="30"
            fontWeight="500"
          >
            {value ? days : "—"}
          </text>
          <text
            x={cx}
            y={cy + 20}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontFamily="var(--font-mono)"
            fontSize="9"
            letterSpacing="2"
          >
            {days === 1 && value ? "DAY" : "DAYS"}
          </text>
        </svg>

        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => commitDays(p)}
                className={`rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
                  value && days === p
                    ? "border-glow text-glow"
                    : "border-border-strong text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}d
              </button>
            ))}
          </div>

          <div className="mt-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Closes
            </div>
            <div className="mt-1.5 font-mono text-sm tabular-nums">
              {value ? new Date(value).toLocaleString() : "Turn the dial to set a deadline"}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setExact((v) => !v)}
            className="mt-4 text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            {exact ? "Hide exact time" : "Set an exact time"}
          </button>

          {exact && (
            <input
              type="datetime-local"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="mt-3 block h-10 w-full border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:border-glow"
            />
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </div>
  );
}
