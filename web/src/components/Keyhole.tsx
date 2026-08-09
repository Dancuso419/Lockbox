/**
 * Keyhole — the signature visual. A keyhole silhouette cut into the surface;
 * through it you glimpse a warm-lit private gathering (bokeh) and volumetric
 * god-rays. Monochrome + the single warm "glow" accent. Themeable, no external
 * image. Motion is CSS-only (transform/opacity) so it respects reduced-motion.
 */
export default function Keyhole({ className = "" }: { className?: string }) {
  return (
    <div className={`relative ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 400 520"
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ overflow: "visible" }}
      >
        <defs>
          <clipPath id="kh-clip">
            <circle cx="200" cy="175" r="105" />
            <path d="M168 250 L232 250 L286 452 L114 452 Z" />
          </clipPath>

          <radialGradient id="kh-glow" cx="50%" cy="38%" r="60%">
            <stop offset="0%" stopColor="var(--glow-strong)" stopOpacity="0.95" />
            <stop offset="42%" stopColor="var(--glow)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--glow)" stopOpacity="0" />
          </radialGradient>

          <linearGradient id="kh-ray" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--glow)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--glow)" stopOpacity="0" />
          </linearGradient>

          <filter id="kh-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        {/* Everything drawn inside the keyhole shape */}
        <g clipPath="url(#kh-clip)">
          {/* deep interior */}
          <rect x="0" y="0" width="400" height="520" fill="oklch(0.1 0.004 260)" />

          {/* rotating volumetric god-rays */}
          <g className="kh-rays" style={{ transformOrigin: "200px 190px" }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <rect
                key={i}
                x="196"
                y="-140"
                width="8"
                height="360"
                rx="4"
                fill="url(#kh-ray)"
                transform={`rotate(${(360 / 12) * i} 200 190)`}
                opacity="0.5"
              />
            ))}
          </g>

          {/* warm glow */}
          <ellipse cx="200" cy="185" rx="150" ry="150" fill="url(#kh-glow)" />

          {/* the private gathering — soft bokeh figures */}
          <g filter="url(#kh-soft)" className="kh-bokeh">
            <circle cx="150" cy="150" r="16" fill="var(--glow)" opacity="0.5" />
            <circle cx="235" cy="135" r="12" fill="var(--glow-strong)" opacity="0.55" />
            <circle cx="200" cy="185" r="22" fill="var(--glow-strong)" opacity="0.45" />
            <circle cx="120" cy="205" r="9" fill="var(--glow)" opacity="0.4" />
            <circle cx="270" cy="200" r="14" fill="var(--glow)" opacity="0.4" />
            <circle cx="185" cy="120" r="7" fill="#fff" opacity="0.5" />
            <circle cx="215" cy="240" r="10" fill="var(--glow-strong)" opacity="0.35" />
          </g>
        </g>

        {/* keyhole rim highlight */}
        <g fill="none" stroke="var(--border-strong)" strokeWidth="1.5">
          <circle cx="200" cy="175" r="105" />
          <path d="M168 250 L232 250 L286 452 L114 452 Z" />
        </g>
        <g fill="none" stroke="var(--glow)" strokeOpacity="0.35" strokeWidth="1">
          <circle cx="200" cy="175" r="104" />
        </g>
      </svg>

      <style>{`
        @keyframes kh-spin { to { transform: rotate(360deg); } }
        @keyframes kh-breathe { 0%,100% { opacity: .85; } 50% { opacity: 1; } }
        .kh-rays { animation: kh-spin 60s linear infinite; }
        .kh-bokeh { animation: kh-breathe 6s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
