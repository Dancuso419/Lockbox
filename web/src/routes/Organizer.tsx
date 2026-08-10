import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { isAddress } from "viem";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import CreatePoolForm from "@/components/CreatePoolForm";
import AllocationForm from "@/components/AllocationForm";
import CompliancePanel from "@/components/CompliancePanel";
import UnclaimedPanel from "@/components/UnclaimedPanel";
import { readPool } from "@/lib/contracts";
import Eyebrow from "@/components/Eyebrow";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

export default function Organizer() {
  const publicClient = usePublicClient();

  const [poolInput, setPoolInput] = useState("");
  const [selectedPool, setSelectedPool] = useState<`0x${string}` | null>(null);

  // resolved for UnclaimedPanel display
  const [poolDecimals, setPoolDecimals] = useState(18);
  const [poolAsset, setPoolAsset] = useState<`0x${string}` | undefined>(undefined);

  function applyPool(addr: `0x${string}`) {
    setSelectedPool(addr);
    setPoolInput(addr);
  }

  // When pool is selected, resolve decimals (same pattern as ClaimForm/PublicPoolCard)
  useEffect(() => {
    if (!publicClient || !selectedPool || !isAddress(selectedPool)) return;
    let cancelled = false;

    async function resolve() {
      if (!publicClient || !selectedPool) return;
      try {
        const ps = await readPool(publicClient, selectedPool);
        if (cancelled) return;
        setPoolAsset(ps.asset);
        if (ps.asset === ZERO_ADDR) { setPoolDecimals(18); return; }
        try {
          const d = await publicClient.readContract({
            address: ps.asset,
            abi: [{ name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" }],
            functionName: "decimals",
          }) as number;
          if (!cancelled) setPoolDecimals(d);
        } catch {
          // ponytail: fallback 18
          if (!cancelled) setPoolDecimals(18);
        }
      } catch {
        // pool not reachable yet
      }
    }

    resolve();
    return () => { cancelled = true; };
  }, [publicClient, selectedPool]);

  const poolValid = selectedPool && isAddress(selectedPool);

  return (
    <div className="shell shell-narrow space-y-6 py-16">
      <div className="mb-2">
        <Eyebrow>Organizer</Eyebrow>
        <h1 className="font-display mt-5 text-[clamp(2rem,4vw,2.75rem)]">Run a confidential pool</h1>
        <p className="mt-5 max-w-lg text-sm leading-relaxed text-muted-foreground">
          Fund once, allocate privately inside the TEE, attest the split on-chain, and reveal only
          the non-claimants to yourself after the deadline.
        </p>
      </div>

      {/* Step 1 — Create pool */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Badge variant="outline" className="text-xs font-mono">1</Badge>
            Create pool
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CreatePoolForm onPoolCreated={applyPool} />
        </CardContent>
      </Card>

      {/* Pool selector — for existing pools */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Select existing pool</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="Pool address (0x…)"
              value={poolInput}
              onChange={(e) => setPoolInput(e.target.value)}
              className="font-mono text-sm"
            />
            <button
              className="shrink-0 rounded-full border border-border-strong px-4 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-40"
              disabled={!isAddress(poolInput)}
              onClick={() => {
                if (isAddress(poolInput)) applyPool(poolInput as `0x${string}`);
              }}
            >
              Select
            </button>
          </div>
          {selectedPool && (
            <p className="text-xs text-muted-foreground font-mono break-all">
              Active pool: <span className="text-foreground">{selectedPool}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Steps 2–4 — only when a pool is selected */}
      {poolValid && (
        <>
          {/* Step 2 — Submit allocation */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Badge variant="outline" className="text-xs font-mono">2</Badge>
                Submit allocation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AllocationForm pool={selectedPool} />
            </CardContent>
          </Card>

          {/* Step 3 — Compliance */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Badge variant="outline" className="text-xs font-mono">3</Badge>
                Publish compliance report
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CompliancePanel pool={selectedPool} />
            </CardContent>
          </Card>

          {/* Step 4 — Unclaimed / sweep (after deadline) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Badge variant="outline" className="text-xs font-mono">4</Badge>
                Unclaimed funds <span className="text-xs font-normal text-muted-foreground">(after deadline)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <UnclaimedPanel pool={selectedPool} decimals={poolDecimals} asset={poolAsset} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
