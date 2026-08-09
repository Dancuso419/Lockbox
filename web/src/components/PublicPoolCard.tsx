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

export default function PublicPoolCard({ address }: Props) {
  const publicClient = usePublicClient();
  const [state, setState] = useState<PoolState | null>(null);
  const [decimals, setDecimals] = useState(18);
  const [complianceOk, setComplianceOk] = useState<boolean | null>(null);
  const [claimedLogs, setClaimedLogs] = useState<ClaimedLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicClient || !isAddress(address)) return;

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
  }, [publicClient, address]);

  if (error) {
    return (
      <Card className="border-red-200">
        <CardContent className="pt-6">
          <p className="text-red-600 text-sm">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!state) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm animate-pulse">Loading pool…</p>
        </CardContent>
      </Card>
    );
  }

  const remaining = state.totalDeposited - state.totalClaimed;
  const ticker = state.asset === ZERO_ADDR ? "C2FLR" : "tokens";

  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2 flex-wrap">
          <a
            href={`${CONFIG.explorer}/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-blue-600 hover:underline text-sm break-all"
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
          <span className="font-mono text-xs break-all text-gray-700">
            {state.asset === ZERO_ADDR ? "Native (C2FLR)" : state.asset}
          </span>

          <span>Deadline</span>
          <span className="tabular-nums text-gray-700">{fmtDeadline(state.deadline)}</span>

          <span>Organizer</span>
          <a
            href={`${CONFIG.explorer}/address/${state.organizer}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-blue-600 hover:underline break-all"
          >
            {state.organizer}
          </a>
        </div>

        {/* Amounts */}
        <div className="rounded-md border bg-gray-50 p-3 space-y-1">
          <Row label="Total deposited" value={`${fmtAmount(state.totalDeposited, decimals)} ${ticker}`} />
          <Row label="Total claimed"   value={`${fmtAmount(state.totalClaimed, decimals)} ${ticker}`} />
          <Row label="Remaining"       value={`${fmtAmount(remaining, decimals)} ${ticker}`} accent />
        </div>

        {/* Compliance section */}
        {state.complianceReported && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-800">Compliance Report</span>
              {complianceOk === true && (
                <Badge className="bg-green-100 text-green-800 border-green-200">Compliance verified ✓</Badge>
              )}
              {complianceOk === false && (
                <Badge className="bg-red-100 text-red-800 border-red-200">✗ invalid signature</Badge>
              )}
            </div>
            <Row label="Reported recipients"      value={state.reportedRecipientCount.toString()} />
            <Row label="Reported total allocated" value={`${fmtAmount(state.reportedTotalAllocated, decimals)} ${ticker}`} />
            {/* Per-recipient amounts are never on-chain — this is intentional */}
            <div className="mt-1 rounded bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
              Individual allocations: <strong>hidden</strong> — amounts are processed inside the TEE and never written on-chain.
            </div>
          </div>
        )}

        {/* Claimed events */}
        {claimedLogs.length > 0 && (
          <div>
            <p className="font-medium text-gray-800 mb-1">Recent claims ({claimedLogs.length})</p>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-muted-foreground">
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
                          className="font-mono text-blue-600 hover:underline"
                        >
                          {l.recipient.slice(0, 8)}…{l.recipient.slice(-6)}
                        </a>
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-right text-gray-700">
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
      <span className={`tabular-nums font-mono text-xs ${accent ? "font-semibold text-blue-700" : "text-gray-700"}`}>
        {value}
      </span>
    </div>
  );
}
