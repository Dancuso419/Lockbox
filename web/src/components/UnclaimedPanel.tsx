import { useState } from "react";
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import { formatUnits, getAddress, hexToBytes } from "viem";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CONFIG } from "@/config";
import { poolConfig } from "@/lib/contracts";
import { TeeClient } from "@/lib/teeClient";
import { newEphemeralKey, decryptWith } from "@/lib/ecies";
import { unclaimedChallenge } from "@/lib/challenge";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

interface UnclaimedRow {
  recipient: string;
  amount: string;
}

interface Props {
  pool: `0x${string}`;
  decimals?: number;
  asset?: `0x${string}`;
}

export default function UnclaimedPanel({ pool, decimals = 18, asset }: Props) {
  const { isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [revealing, setRevealing] = useState(false);
  const [rows, setRows] = useState<UnclaimedRow[] | null>(null);

  const [sweeping, setSweeping] = useState(false);
  const [sweepHash, setSweepHash] = useState<string | null>(null);

  const ticker = asset === ZERO_ADDR ? "C2FLR" : "tokens";

  async function handleReveal() {
    if (!isConnected) { toast.error("Connect your wallet first."); return; }
    setRevealing(true);
    setRows(null);
    try {
      // ephemeral key — priv never leaves this scope
      const eph = newEphemeralKey();
      const msg = unclaimedChallenge(getAddress(pool), eph.pubHex);
      const sig = await signMessageAsync({ message: msg });

      const { report } = await TeeClient.unclaimedReport({
        pool,
        organizerPubHex: eph.pubHex,
        challengeSig: sig,
      });

      let decrypted: Uint8Array;
      try {
        decrypted = decryptWith(eph.privHex, hexToBytes(report as `0x${string}`));
      } catch {
        toast.error("Couldn't decrypt the report — wrong organizer wallet or corrupted response.");
        return;
      }

      // Never log eph.privHex or the parsed rows
      const parsed: UnclaimedRow[] = JSON.parse(new TextDecoder().decode(decrypted));
      setRows(parsed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Surface contract revert (e.g. deadline not passed) clearly
      if (msg.toLowerCase().includes("revert") || msg.toLowerCase().includes("deadline")) {
        toast.error("Contract rejected: deadline may not have passed yet, or you are not the organizer.");
      } else {
        toast.error(msg.length > 160 ? msg.slice(0, 160) + "…" : msg);
      }
    } finally {
      setRevealing(false);
    }
  }

  async function handleSweep() {
    if (!publicClient) return;
    setSweeping(true);
    setSweepHash(null);
    try {
      const hash = await writeContractAsync({
        ...poolConfig(pool),
        functionName: "sweep",
        args: [],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setSweepHash(hash);
      toast.success("Remaining funds swept.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("revert") || msg.toLowerCase().includes("deadline")) {
        toast.error("Sweep rejected: deadline may not have passed yet.");
      } else {
        toast.error(msg.length > 160 ? msg.slice(0, 160) + "…" : msg);
      }
    } finally {
      setSweeping(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        Both actions require the pool deadline to have passed — the contract enforces this and
        will revert otherwise. Your wallet must be the pool organizer.
      </div>

      <Button onClick={handleReveal} disabled={revealing || !isConnected} className="w-full">
        {revealing ? "Decrypting…" : "Reveal non-claimants"}
      </Button>

      {rows !== null && (
        rows.length === 0 ? (
          <p className="text-sm text-success">All recipients have claimed.</p>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <p className="text-xs text-muted-foreground px-3 py-2 bg-muted border-b">
              {rows.length} unclaimed allocation(s) — visible only in your browser
            </p>
            <table className="w-full text-xs">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Recipient</th>
                  <th className="text-right px-3 py-2">Amount ({ticker})</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5 font-mono">
                      <a href={`${CONFIG.explorer}/address/${r.recipient}`} target="_blank"
                        rel="noopener noreferrer" className="text-glow hover:underline">
                        {r.recipient.slice(0, 8)}…{r.recipient.slice(-6)}
                      </a>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-foreground">
                      {formatUnits(BigInt(r.amount), decimals)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      <div className="border-t pt-4">
        <Button onClick={handleSweep} disabled={sweeping || !isConnected} variant="outline"
          className="w-full">
          {sweeping ? "Sweeping…" : "Sweep remaining funds"}
        </Button>
        {sweepHash && (
          <p className="mt-2 text-xs text-success">
            Swept:{" "}
            <a href={`${CONFIG.explorer}/tx/${sweepHash}`} target="_blank" rel="noopener noreferrer"
              className="font-mono text-glow hover:underline break-all">{sweepHash}</a>
          </p>
        )}
      </div>
    </div>
  );
}
