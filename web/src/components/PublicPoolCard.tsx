import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits, isAddress, decodeFunctionData } from "viem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2 flex-wrap">
          <a
            href={`${CONFIG.explorer}/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-glow hover:underline text-sm break-all"
          >
            {address}
          </a>
          <Badge variant={state.status === 0 ? "default" : "secondary"}>
            {statusLabel(state.status)}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {/* Pool metadata */}
        <div className="grid grid-cols-2 gap-2 text-muted-foreground">
          <span>Asset</span>
          <span className="font-mono text-xs break-all text-foreground">
            {state.asset === ZERO_ADDR ? "Native (C2FLR)" : state.asset}
          </span>

          <span>Deadline</span>
          <span className="tabular-nums text-foreground">{fmtDeadline(state.deadline)}</span>

          <span>Organizer</span>
          <a
            href={`${CONFIG.explorer}/address/${state.organizer}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-glow hover:underline break-all"
          >
            {state.organizer}
          </a>
        </div>

        {/* Amounts */}
        <div className="rounded-md border bg-muted p-3 space-y-1">
          <Row label="Total deposited" value={`${fmtAmount(state.totalDeposited, decimals)} ${ticker}`} />
          <Row label="Total claimed"   value={`${fmtAmount(state.totalClaimed, decimals)} ${ticker}`} />
          <Row label="Remaining"       value={`${fmtAmount(remaining, decimals)} ${ticker}`} accent />
        </div>

        {/* Compliance section */}
        {state.complianceReported && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-foreground">Compliance Report</span>
              {complianceOk === true && (
                <Badge variant="success">Compliance verified ✓</Badge>
              )}
              {complianceOk === false && (
                <Badge variant="destructive">✗ invalid signature</Badge>
              )}
            </div>
            <Row label="Reported recipients"      value={state.reportedRecipientCount.toString()} />
            <Row label="Reported total allocated" value={`${fmtAmount(state.reportedTotalAllocated, decimals)} ${ticker}`} />
            {/* Per-recipient amounts are never on-chain — this is intentional */}
            <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
              <span className="text-glow">◍</span>
              Individual allocations: <strong className="text-foreground">hidden</strong> — sealed in the TEE, never written on-chain.
            </div>
          </div>
        )}

        {/* Claimed events */}
        {claimedLogs.length > 0 && (
          <div>
            <p className="font-medium text-foreground mb-1">Recent claims ({claimedLogs.length})</p>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Recipient</th>
                    <th className="text-right px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {claimedLogs.map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5">
                        <a
                          href={`${CONFIG.explorer}/address/${l.recipient}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-glow hover:underline"
                        >
                          {l.recipient.slice(0, 8)}…{l.recipient.slice(-6)}
                        </a>
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-right text-foreground">
                        {fmtAmount(l.amount, decimals)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono text-xs tabular-nums ${accent ? "font-semibold text-foreground" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}
