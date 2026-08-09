import { useState } from "react";
import { useWriteContract, usePublicClient } from "wagmi";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CONFIG } from "@/config";
import { poolConfig } from "@/lib/contracts";
import { TeeClient } from "@/lib/teeClient";

interface Props {
  pool: `0x${string}`;
}

export default function CompliancePanel({ pool }: Props) {
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

      <Button onClick={handlePublish} disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white">
        {loading ? "Fetching report & publishing…" : "Publish compliance report"}
      </Button>

      {result && (
        <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm space-y-2">
          <p className="font-medium text-green-800">Compliance report published</p>
          <div className="grid grid-cols-2 gap-1 text-xs text-gray-700">
            <span className="text-muted-foreground">Recipients</span>
            <span className="tabular-nums font-mono">{result.recipientCount}</span>
            <span className="text-muted-foreground">Total allocated (base units)</span>
            <span className="tabular-nums font-mono break-all">{result.totalAllocated}</span>
          </div>
          <a href={`${CONFIG.explorer}/tx/${result.txHash}`} target="_blank" rel="noopener noreferrer"
            className="block font-mono text-blue-600 hover:underline break-all text-xs">
            {result.txHash}
          </a>
        </div>
      )}
    </div>
  );
}
