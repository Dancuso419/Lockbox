import type { ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/** Grey bar standing in for a value that is still loading. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-muted", className)} aria-hidden="true" />;
}

/**
 * Something failed. Always says what failed, shows the underlying message, and
 * offers the way out — a dead end with a red sentence is what reads unfinished.
 */
export function ErrorState({
  title,
  detail,
  onRetry,
  className = "",
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-destructive/40 bg-surface p-6", className)} role="alert">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-destructive">
        <AlertTriangle className="size-3.5" />
        {title}
      </div>
      {detail && (
        <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground">{detail}</p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border-strong px-4 py-2 text-sm transition-colors hover:bg-accent"
        >
          <RotateCcw className="size-3.5" /> Try again
        </button>
      )}
    </div>
  );
}

/** Nothing to show yet — and what the reader should do about it. */
export function EmptyState({
  title,
  detail,
  action,
  className = "",
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-dashed border-border-strong bg-surface p-8 text-center", className)}>
      <p className="text-sm font-medium">{title}</p>
      {detail && <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{detail}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
