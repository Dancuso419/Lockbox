import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { ChevronDown, X } from "lucide-react";
import { readPool } from "@/lib/contracts";
import { listPools, forgetPool } from "@/lib/myPools";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

type Row = {
  address: `0x${string}`;
  deposited?: string;
  remaining?: string;
  ticker?: string;
  open?: boolean;
  failed?: boolean;
};

/**
 * The pools this wallet has worked on. Addresses come from local memory (see
 * lib/myPools), but every figure beside them is read from the chain — a stale
 * entry shows as unreachable rather than quietly lying about a balance.
 */
export default function PoolPicker({
  owner,
  current,
  onSelect,
}: {
  owner?: string;
  current?: string | null;
  onSelect: (pool: `0x${string}`) => void;
}) {
  const publicClient = usePublicClient();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  const addresses = listPools(owner);
  // localStorage hands back a new array each render, so the effect keys on the
  // contents rather than the reference — otherwise it re-runs forever.
  const addressKey = addresses.join(",");

  useEffect(() => {
    const list = addressKey ? addressKey.split(",") : [];
    if (!open || !publicClient || list.length === 0) return;
    let cancelled = false;

    (async () => {
      setRows(list.map((a) => ({ address: a as `0x${string}` })));
      for (const a of list) {
        try {
          const ps = await readPool(publicClient, a as `0x${string}`);
          if (cancelled) return;
          const ticker = ps.asset === ZERO_ADDR ? "C2FLR" : "tokens";
          setRows((prev) =>
            prev.map((r) =>
              r.address === a
                ? {
                    ...r,
                    deposited: formatUnits(ps.totalDeposited, 18),
                    remaining: formatUnits(ps.totalDeposited - ps.totalClaimed, 18),
                    ticker,
                    open: ps.status === 0,
                  }
                : r
            )
          );
        } catch {
          if (cancelled) return;
          setRows((prev) =>
            prev.map((r) => (r.address === a ? { ...r, failed: true } : r))
          );
        }
      }
    })();

    return () => { cancelled = true; };
  }, [open, publicClient, addressKey]);

  if (!owner || addresses.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border-strong px-3 py-2 text-xs transition-colors hover:bg-accent"
      >
        <span className="font-mono uppercase tracking-[0.14em] text-muted-foreground">
          Your pools ({addresses.length})
        </span>
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <ul className="absolute right-0 z-[1200] mt-2 w-full min-w-[22rem] overflow-hidden rounded-xl border border-border bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.3)]">
          {rows.map((r) => {
            const isCurrent = current?.toLowerCase() === r.address.toLowerCase();
            return (
              <li key={r.address} className="border-b border-border last:border-0">
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(r.address);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs">
                        {r.address.slice(0, 10)}…{r.address.slice(-8)}
                      </span>
                      {isCurrent && (
                        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-glow">
                          active
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {r.failed ? (
                        <span className="text-destructive">unreachable on this network</span>
                      ) : r.deposited ? (
                        <>
                          {r.remaining} / {r.deposited} {r.ticker} left
                          <span className={r.open ? "text-glow" : ""}>
                            {" · "}
                            {r.open ? "open" : "closed"}
                          </span>
                        </>
                      ) : (
                        "reading…"
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label={`Forget ${r.address}`}
                    onClick={() => {
                      forgetPool(owner, r.address);
                      setRows((prev) => prev.filter((x) => x.address !== r.address));
                    }}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
          <li className="border-t border-border px-4 py-2 text-[10px] leading-relaxed text-muted-foreground">
            Remembered in this browser — the address is what matters, so keep a copy.
          </li>
        </ul>
      )}
    </div>
  );
}
