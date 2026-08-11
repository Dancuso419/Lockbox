import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits, isAddress, decodeFunctionData } from "viem";
import { Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Stat, Field } from "./PageHeader";
import { readPool } from "@/lib/contracts";
import { verifyCompliance } from "@/lib/compliance";
import { CONFIG } from "@/config";
import PoolAbi from "@/abi/Pool.json";
import type { PoolState } from "@/lib/contracts";
import { Skeleton, ErrorState } from "./States";

// Claimed(address indexed recipient, uint256 amount, uint256 nonce)
const CLAIMED_EVENT_ABI = {
  type: "event",
  name: "Claimed",
  inputs: [
    { name: "recipient", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
    { name: "nonce", type: "uint256", indexed: false },
  ],
} as const;

// ComplianceReported event — to get the tx hash so we can decode the signature
const COMPLIANCE_REPORTED_EVENT_ABI = {
  type: "event",
  name: "ComplianceReported",
  inputs: [
    { name: "totalDeposited", type: "uint256", indexed: false },
    { name: "totalAllocated", type: "uint256", indexed: false },
    { name: "recipientCount", type: "uint256", indexed: false },
  ],
} as const;

type ClaimedLog = { recipient: `0x${string}`; amount: bigint };

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

function fmtDeadline(ts: bigint): string {
  if (ts === 0n) return "—";
  return new Date(Number(ts) * 1000).toLocaleString();
}

function fmtAmount(raw: bigint, decimals: number): string {
  return formatUnits(raw, decimals);
}

function statusLabel(s: number): string {
  return s === 0 ? "Open" : "Closed";
}

interface Props {
  address: `0x${string}`;
}

/**
 * viem's read errors are three paragraphs of SDK prose. Say the one thing the
 * reader can act on; keep the raw text out of the UI.
 */
function explainLoadError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("returned no data") || lower.includes("not a contract"))
    return "No Lockbox pool lives at this address on Coston2. Check you pasted the pool address (not the factory or your wallet), then retry.";
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("timeout"))
    return "Couldn't reach the Coston2 RPC. Check your connection and retry.";
  return `${raw.slice(0, 200)} Check the address is a Lockbox pool on Coston2, then retry.`;
}

export default function PublicPoolCard({ address }: Props) {
  const publicClient = usePublicClient();
  const [state, setState] = useState<PoolState | null>(null);
  const [decimals, setDecimals] = useState(18);
  const [complianceOk, setComplianceOk] = useState<boolean | null>(null);
  const [claimedLogs, setClaimedLogs] = useState<ClaimedLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!publicClient || !isAddress(address)) return;
    setError(null);
    setState(null);

    let cancelled = false;

    async function load() {
      if (!publicClient) return;
      try {
        const ps = await readPool(publicClient, address);
        if (cancelled) return;
        setState(ps);

        // Resolve token decimals
        let dec = 18;
        if (ps.asset !== ZERO_ADDR) {
          try {
            const d = await publicClient.readContract({
              address: ps.asset,
              abi: [{ name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" }],
              functionName: "decimals",
            });
            dec = d as number;
          } catch {
            // ponytail: fallback 18 on any ERC20 decimals failure
          }
        }
        if (!cancelled) setDecimals(dec);

        // Compliance verification — fetch signature from the publishComplianceReport calldata
        if (ps.complianceReported) {
          try {
            const cLogs = await publicClient.getLogs({
              address,
              event: COMPLIANCE_REPORTED_EVENT_ABI,
              fromBlock: "earliest",
              toBlock: "latest",
            });
            if (cLogs.length > 0) {
              const txHash = cLogs[0].transactionHash;
              if (txHash) {
                const tx = await publicClient.getTransaction({ hash: txHash });
                const decoded = decodeFunctionData({
                  abi: PoolAbi,
                  data: tx.input,
                });
                if (decoded.functionName === "publishComplianceReport") {
                  const args = decoded.args as [bigint, bigint, `0x${string}`];
                  const sig = args[2];
                  const ok = await verifyCompliance(
                    address,
                    ps.totalDeposited,
                    ps.reportedTotalAllocated,
                    ps.reportedRecipientCount,
                    sig,
                    ps.authorizedSigner
                  );
                  if (!cancelled) setComplianceOk(ok);
                }
              }
            }
          } catch {
            // getLogs/getTransaction can fail; compliance badge stays null (not shown)
          }
        }

        // Recent Claimed events
        try {
          const logs = await publicClient.getLogs({
            address,
            event: CLAIMED_EVENT_ABI,
            fromBlock: "earliest",
            toBlock: "latest",
          });
          if (!cancelled) {
            setClaimedLogs(
              logs.map((l) => ({
                recipient: l.args.recipient as `0x${string}`,
                amount: l.args.amount as bigint,
              }))
            );
          }
        } catch {
          // getLogs can fail on public RPCs; non-fatal
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load pool");
      }
    }

    load();
    return () => { cancelled = true; };
  }, [publicClient, address, reloadKey]);

  if (error) {
    return (
      <ErrorState
        title="Couldn't load this pool"
        detail={explainLoadError(error)}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }

  if (!state) {
    // Skeleton mirrors the loaded layout, so nothing jumps when it arrives.
    return (
      <Card aria-busy="true">
        <CardContent className="space-y-5">
          <Skeleton className="h-4 w-40" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
          <Skeleton className="h-4 w-56" />
        </CardContent>
      </Card>
    );
  }

  const remaining = state.totalDeposited - state.totalClaimed;
  const ticker = state.asset === ZERO_ADDR ? "C2FLR" : "tokens";
  const open = state.status === 0;

  return (
    <div className="space-y-12">
      {/* What the pool is worth — the numbers lead, everything else supports. */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${
                open ? "border-glow/50 text-glow" : "border-border-strong text-muted-foreground"
              }`}
            >
              <span className={`size-1.5 rounded-full ${open ? "bg-glow" : "bg-muted-foreground"}`} />
              {statusLabel(state.status)}
            </span>
            <a
              href={`${CONFIG.explorer}/address/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {address}
            </a>
          </div>
        </div>

        <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
          <Stat label="Deposited" value={fmtAmount(state.totalDeposited, decimals)} unit={ticker} />
          <Stat label="Claimed" value={fmtAmount(state.totalClaimed, decimals)} unit={ticker} />
          <Stat label="Remaining" value={fmtAmount(remaining, decimals)} unit={ticker} accent />
        </div>
      </section>

      <section className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Attestation — the reason a stranger would come to this page at all. */}
        <div>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Compliance attestation
          </h2>
          {state.complianceReported ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
              <div className="flex flex-wrap items-center gap-3 border-b border-border p-5">
                {complianceOk === true && (
                  <span className="inline-flex items-center gap-2 border border-success/50 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-success">
                    <Check className="size-3" /> Signature verified
                  </span>
                )}
                {complianceOk === false && (
                  <span className="inline-flex items-center gap-2 border border-destructive/50 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">
                    <X className="size-3" /> Invalid signature
                  </span>
                )}
                {complianceOk === null && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Checking signature…
                  </span>
                )}
                <span className="text-xs text-muted-foreground">re-checked in your browser</span>
              </div>
              <div className="grid gap-px bg-border sm:grid-cols-2">
                <Stat label="Recipients" value={state.reportedRecipientCount.toString()} />
                <Stat
                  label="Allocated"
                  value={fmtAmount(state.reportedTotalAllocated, decimals)}
                  unit={ticker}
                />
              </div>
              <p className="border-t border-border p-5 text-xs leading-relaxed text-muted-foreground">
                <span className="text-glow">◍</span> Individual allocations are{" "}
                <strong className="font-medium text-foreground">hidden</strong> — sealed in the
                enclave, never written on-chain. The attestation proves they sum to the deposit
                without naming a single one.
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-border-strong bg-surface p-6">
              <p className="text-sm font-medium">Not attested yet</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                The organizer hasn't published the signed report for this pool. Until they do,
                the totals above are all the chain can tell you.
              </p>
            </div>
          )}
        </div>

        {/* Everything else about the pool, as a plain record. */}
        <div>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Pool record
          </h2>
          <dl className="mt-4 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
            <Field label="Asset">
              {state.asset === ZERO_ADDR ? (
                "Native (C2FLR)"
              ) : (
                <span className="font-mono text-xs">{state.asset}</span>
              )}
            </Field>
            <Field label="Deadline">
              <span className="tabular-nums">{fmtDeadline(state.deadline)}</span>
            </Field>
            <Field label="Organizer">
              <a
                href={`${CONFIG.explorer}/address/${state.organizer}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-glow hover:underline"
              >
                {state.organizer}
              </a>
            </Field>
            <Field label="Network">Flare · Coston2</Field>
          </dl>
        </div>
      </section>

      {/* Claims are public by nature — the amount is visible the moment it moves. */}
      {claimedLogs.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Claims
            </h2>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {claimedLogs.length}
            </span>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-[0.18em] font-normal text-muted-foreground">
                    Recipient
                  </th>
                  <th className="px-5 py-3 text-right font-mono text-[10px] uppercase tracking-[0.18em] font-normal text-muted-foreground">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {claimedLogs.map((l, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-accent/50">
                    <td className="px-5 py-3">
                      <a
                        href={`${CONFIG.explorer}/address/${l.recipient}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-glow hover:underline"
                      >
                        {l.recipient.slice(0, 10)}…{l.recipient.slice(-8)}
                      </a>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-xs tabular-nums">
                      {fmtAmount(l.amount, decimals)} <span className="text-muted-foreground">{ticker}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            A claim moves money, so its amount is on-chain. Who was <em>allocated</em> what, and
            who never claimed, stays sealed.
          </p>
        </section>
      )}
    </div>
  );
}
