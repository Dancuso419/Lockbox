import type { ReactNode } from "react";
import Eyebrow from "./Eyebrow";

/**
 * The masthead every app page opens with. Title on the left, an optional
 * control (a pool address field, usually) parked on the right, so the primary
 * input sits on the same line as the thing it belongs to instead of below it.
 */
export default function PageHeader({
  eyebrow,
  title,
  lede,
  aside,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: string;
  aside?: ReactNode;
}) {
  return (
    <header className="border-b border-border pb-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-end">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="font-display mt-5 text-[clamp(2rem,4vw,2.75rem)]">{title}</h1>
          {lede && (
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground">{lede}</p>
          )}
        </div>
        {aside && <div className="lg:justify-self-end lg:w-full">{aside}</div>}
      </div>
    </header>
  );
}

/** Uppercase micro-label over a big tabular number. */
export function Stat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-background p-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-3 font-mono text-2xl tabular-nums sm:text-[1.75rem] ${
          accent ? "text-glow" : "text-foreground"
        }`}
      >
        {value}
        {unit && <span className="ml-1.5 text-sm text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

/** Label/value pair for metadata strips. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-background p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 break-all text-sm">{children}</div>
    </div>
  );
}
