import { useState } from "react";
import { useWriteContract, usePublicClient } from "wagmi";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CONFIG } from "@/config";
import { poolConfig } from "@/lib/contracts";
import { TeeClient } from "@/lib/teeClient";

interface Props {
  pool: `0x${string}`;
  /** Fired once the report is on-chain. */
  onPublished?: () => void;
}

export default function CompliancePanel({ pool, onPublished }: Props) {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ txHash: string; recipientCount: number; totalAllocated: string } | null>(null);

  async function handlePublish() {
    if (!publicClient) return;
    setLoading(true);
    setResult(null);
    try {
      const { totalAllocated, recipientCount, signature } = await TeeClient.complianceReport(pool);

      const hash = await writeContractAsync({
        ...poolConfig(pool),
        functionName: "publishComplianceReport",
        args: [BigInt(totalAllocated), BigInt(recipientCount), signature as `0x${string}`],
      });

      await publicClient.waitForTransactionReceipt({ hash });
      setResult({ txHash: hash, recipientCount, totalAllocated });
      onPublished?.();
      toast.success("Compliance report published on-chain.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.length > 160 ? msg.slice(0, 160) + "…" : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Fetches the TEE-signed compliance report and writes it on-chain.
        The pool must have allocations submitted before this can succeed.
      </p>

      <Button onClick={handlePublish} disabled={loading} className="w-full">
        {loading ? "Fetching report & publishing…" : "Publish compliance report"}
      </Button>

      {result && (
        <div className="space-y-2 rounded-lg border border-success/25 bg-success/10 p-3 text-sm">
          <p className="font-medium text-success">Compliance report published</p>
          <div className="grid grid-cols-2 gap-1 text-xs text-foreground">
            <span className="text-muted-foreground">Recipients</span>
            <span className="font-mono tabular-nums">{result.recipientCount}</span>
            <span className="text-muted-foreground">Total allocated (base units)</span>
            <span className="break-all font-mono tabular-nums">{result.totalAllocated}</span>
          </div>
          <a href={`${CONFIG.explorer}/tx/${result.txHash}`} target="_blank" rel="noopener noreferrer"
            className="block break-all font-mono text-xs text-glow hover:underline">
            {result.txHash}
          </a>
        </div>
      )}
    </div>
  );
}
