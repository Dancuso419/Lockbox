import { useEffect, useRef, useState } from "react";

/**
 * BoxWall — the signature visual. A wall of safe-deposit boxes: one facility,
 * many private compartments, and only yours opens. That is the product in a
 * single image, which a lone safe (custody, one container) never said.
 *
 * `openIndex` is the box that stands open with light inside; null = all sealed.
 * `interactive` lets the reader open a box by pointing at it — deliberately
 * ONE at a time, so the page never shows the whole table at once, which is
 * exactly the guarantee the product makes.
 */

const COLS = 4;
const ROWS = 3;

// Grid geometry inside the frame.
const PAD = 26;
const GAP = 9;
const CELL_W = 98;
const CELL_H = 100;

function cellXY(i: number) {
  return {
    x: PAD + (i % COLS) * (CELL_W + GAP),
    y: PAD + Math.floor(i / COLS) * (CELL_H + GAP),
  };
}

/** Shares of one pool — uneven on purpose, the way a real award list is. */
const AMOUNTS = [
  "1,250", "400", "12,500", "875",
  "3,000", "250", "6,400", "1,000",
  "150", "2,750", "500", "9,100",
];

/** How far past flat the door swings, in degrees. Past 90° it faces away. */
const MAX_SWING = 118;
const SWING_MS = 420;

export default function BoxWall({
  className = "",
  openIndex = null,
  interactive = false,
  ticker = "FLR",
  amount,
}: {
  className?: string;
  /** Index of the box standing open (0-based), or null for all sealed. */
  openIndex?: number | null;
  /** Let the reader open a box by hovering or focusing it. */
  interactive?: boolean;
  ticker?: string;
  /** Overrides the decorative amount — pass a real one when you have it. */
  amount?: string;
}) {
  const total = COLS * ROWS;
  const [pointed, setPointed] = useState<number | null>(null);
  const base = openIndex == null ? null : ((openIndex % total) + total) % total;
  // Pointing wins, but only ever one box: no way to see two amounts at once.
  const open = interactive && pointed != null ? pointed : base;

  // Swing the door open whenever the open box changes. Moving between boxes
  // restarts the swing on the new one — the eye follows the opening door, so
  // there is nothing to gain from animating the one being left behind.
  const [phase, setPhase] = useState(open == null ? 0 : 1);
  const rafRef = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (open == null) {
      setPhase(0);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase(1);
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / SWING_MS);
      setPhase(1 - Math.pow(1 - t, 3)); // ease-out cubic: fast off the latch
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    setPhase(0);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [open]);

  return (
    <div
      className={`relative ${className}`}
      aria-hidden={interactive ? undefined : "true"}
      onMouseLeave={() => setPointed(null)}
    >
      <svg
        viewBox="0 0 480 380"
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ overflow: "visible" }}
      >
        <defs>
          <linearGradient id="bw-frame" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="oklch(0.335 0.014 262)" />
            <stop offset="60%" stopColor="oklch(0.245 0.013 262)" />
            <stop offset="100%" stopColor="oklch(0.195 0.012 262)" />
          </linearGradient>
          <linearGradient id="bw-door" x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor="oklch(0.325 0.014 262)" />
            <stop offset="55%" stopColor="oklch(0.255 0.013 262)" />
            <stop offset="100%" stopColor="oklch(0.215 0.012 262)" />
          </linearGradient>
          <linearGradient id="bw-swung" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.20 0.012 262)" />
            <stop offset="100%" stopColor="oklch(0.30 0.014 262)" />
          </linearGradient>
          <linearGradient id="bw-rim" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.02" />
            <stop offset="40%" stopColor="#fff" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0.02" />
          </linearGradient>
          {/* Light in a dark cavity, not a solid orange tile: a small hot spot
              at the back-left corner falling off fast. */}
          <radialGradient id="bw-light" cx="26%" cy="46%" r="62%">
            <stop offset="0%" stopColor="var(--glow-strong)" stopOpacity="0.92" />
            <stop offset="38%" stopColor="var(--glow)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--glow)" stopOpacity="0.03" />
          </radialGradient>
          <radialGradient id="bw-spill" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--glow)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--glow)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="bw-shadow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#000" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <filter id="bw-soft" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="12" />
          </filter>
        </defs>

        {/* Cast shadow under the cabinet */}
        <ellipse cx="248" cy="372" rx="196" ry="20" fill="url(#bw-shadow)" />

        {/* Cabinet */}
        <rect x="0" y="0" width="480" height="356" rx="10" fill="url(#bw-frame)" />
        <rect x="14" y="0" width="452" height="2" rx="1" fill="url(#bw-rim)" />

        {/* Closed doors */}
        {Array.from({ length: total }).map((_, i) => {
          if (i === open) return null;
          const { x, y } = cellXY(i);
          return (
            <g
              key={i}
              onMouseEnter={interactive ? () => setPointed(i) : undefined}
              onFocus={interactive ? () => setPointed(i) : undefined}
              onBlur={interactive ? () => setPointed(null) : undefined}
              tabIndex={interactive ? 0 : undefined}
              role={interactive ? "button" : undefined}
              aria-label={interactive ? `Open box ${String(i + 1).padStart(2, "0")}` : undefined}
              className={interactive ? "bw-door cursor-pointer focus:outline-none" : undefined}
            >
              <rect
                x={x}
                y={y}
                width={CELL_W}
                height={CELL_H}
                rx="4"
                fill="url(#bw-door)"
                stroke="#fff"
                strokeOpacity="0.07"
                strokeWidth="1"
              />
              {/* recessed inner line */}
              <rect
                x={x + 7}
                y={y + 7}
                width={CELL_W - 14}
                height={CELL_H - 14}
                rx="2"
                fill="none"
                stroke="#000"
                strokeOpacity="0.22"
                strokeWidth="1"
              />
              {/* number plate */}
              <text
                x={x + 14}
                y={y + 26}
                fill="#fff"
                fillOpacity="0.3"
                fontFamily="var(--font-mono)"
                fontSize="11"
                letterSpacing="1"
              >
                {String(i + 1).padStart(2, "0")}
              </text>
              {/* lock + handle */}
              <circle cx={x + CELL_W - 22} cy={y + CELL_H / 2} r="6" fill="#000" fillOpacity="0.35" />
              <circle
                cx={x + CELL_W - 22}
                cy={y + CELL_H / 2}
                r="6"
                fill="none"
                stroke="#fff"
                strokeOpacity="0.16"
                strokeWidth="1"
              />
              <rect
                x={x + CELL_W - 30}
                y={y + CELL_H - 26}
                width="18"
                height="3"
                rx="1.5"
                fill="#fff"
                fillOpacity="0.1"
              />
            </g>
          );
        })}

        {/* The opening box. The door is drawn as the true projection of a panel
            hinged on its right edge: its free edge travels at -cos(angle) and
            the top/bottom taper by sin(angle), so it passes edge-on at 90° and
            swings out the other side. That is what makes it read as a flip
            rather than a shape being swapped in. */}
        {open != null &&
          (() => {
            const { x, y } = cellXY(open);
            const cx = x + CELL_W;
            const angle = (phase * MAX_SWING * Math.PI) / 180;
            const edge = cx - CELL_W * Math.cos(angle); // free edge of the door
            const taper = 16 * Math.sin(angle); // perspective foreshortening
            const inside = Math.max(0, (phase - 0.45) / 0.55); // contents fade in
            const face = Math.max(0, Math.cos(angle)); // door front, until edge-on
            return (
              <g className="bw-open">
                {/* cavity */}
                <rect x={x} y={y} width={CELL_W} height={CELL_H} rx="4" fill="oklch(0.13 0.01 262)" />
                <rect
                  x={x + 4}
                  y={y + 4}
                  width={CELL_W - 8}
                  height={CELL_H - 8}
                  rx="3"
                  fill="url(#bw-light)"
                  opacity={phase}
                />
                {/* light spilling onto the neighbours */}
                <ellipse
                  cx={cx + 20}
                  cy={y + CELL_H / 2}
                  rx="86"
                  ry="66"
                  fill="url(#bw-spill)"
                  filter="url(#bw-soft)"
                  opacity={phase}
                />
                {/* the one thing inside: this box's share, and nobody else's */}
                <g opacity={inside}>
                  <rect
                    x={x + 11}
                    y={y + 32}
                    width={CELL_W - 22}
                    height="38"
                    rx="2"
                    fill="#000"
                    opacity="0.45"
                  />
                  <text
                    x={x + CELL_W / 2}
                    y={y + 52}
                    textAnchor="middle"
                    fill="#fff"
                    fontFamily="var(--font-mono)"
                    fontSize="17"
                    fontWeight="500"
                  >
                    {amount ?? AMOUNTS[open]}
                  </text>
                  <text
                    x={x + CELL_W / 2}
                    y={y + 66}
                    textAnchor="middle"
                    fill="#fff"
                    fillOpacity="0.62"
                    fontFamily="var(--font-mono)"
                    fontSize="9"
                    letterSpacing="1.5"
                  >
                    {ticker}
                  </text>
                </g>

                {/* the door itself, mid-swing */}
                <path
                  d={`M ${cx} ${y} L ${edge} ${y + taper} L ${edge} ${y + CELL_H - taper} L ${cx} ${y + CELL_H} Z`}
                  fill="url(#bw-swung)"
                  stroke="#fff"
                  strokeOpacity="0.1"
                  strokeWidth="1"
                />
                {/* front face turning away from the light as it opens */}
                <path
                  d={`M ${cx} ${y} L ${edge} ${y + taper} L ${edge} ${y + CELL_H - taper} L ${cx} ${y + CELL_H} Z`}
                  fill="#000"
                  opacity={0.28 * phase}
                />
                {/* The number and lock ride the door, squashing toward the hinge
                    until the panel is edge-on — otherwise they'd pop out of
                    existence the instant the swing starts. */}
                <g
                  opacity={face}
                  transform={`translate(${cx} 0) scale(${Math.max(0.0001, face)} 1) translate(${-cx} 0)`}
                >
                  <text
                    x={x + 14}
                    y={y + 26}
                    fill="#fff"
                    fillOpacity="0.3"
                    fontFamily="var(--font-mono)"
                    fontSize="11"
                    letterSpacing="1"
                  >
                    {String(open + 1).padStart(2, "0")}
                  </text>
                  <circle cx={x + CELL_W - 22} cy={y + CELL_H / 2} r="6" fill="#000" fillOpacity="0.35" />
                  <circle
                    cx={x + CELL_W - 22}
                    cy={y + CELL_H / 2}
                    r="6"
                    fill="none"
                    stroke="#fff"
                    strokeOpacity="0.16"
                    strokeWidth="1"
                  />
                  <rect
                    x={x + CELL_W - 30}
                    y={y + CELL_H - 26}
                    width="18"
                    height="3"
                    rx="1.5"
                    fill="#fff"
                    fillOpacity="0.1"
                  />
                </g>
                <path
                  d={`M ${edge} ${y + taper} L ${edge} ${y + CELL_H - taper}`}
                  stroke="var(--glow)"
                  strokeOpacity={0.5 * phase}
                  strokeWidth="1.5"
                />
              </g>
            );
          })()}
      </svg>

      <style>{`
        @keyframes bw-breathe { 0%,100% { opacity: .92; } 50% { opacity: 1; } }
        .bw-open { animation: bw-breathe 5s ease-in-out infinite; }
        /* Closed doors lift a touch when pointed at, so the wall reads as live. */
        .bw-door rect:first-of-type { transition: fill-opacity 150ms ease; }
        .bw-door:hover rect:first-of-type,
        .bw-door:focus-visible rect:first-of-type { stroke: var(--glow); stroke-opacity: .55; }
        @media (prefers-reduced-motion: reduce) {
          .bw-open { animation: none; }
        }
      `}</style>
    </div>
  );
}

/** Small lockbox mark for the nav and footer. */
export function LockboxMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 3.2v17.6M3.2 12h17.6" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.4" />
      <circle cx="16.4" cy="16.4" r="1.6" fill="currentColor" />
    </svg>
  );
}
