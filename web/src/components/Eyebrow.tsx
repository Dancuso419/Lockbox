import type { ReactNode } from "react";

/** Uppercase micro-label with the orange tick. Sits above every page heading. */
export default function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
      <span className="inline-block h-2 w-2 bg-glow" />
      {children}
    </div>
  );
}
