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
    <div className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Organizer</h1>
        <p className="text-sm text-muted-foreground mt-1">Create a pool, submit allocations, publish compliance, and manage unclaimed funds.</p>
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
              className="px-4 py-2 rounded-md border text-sm bg-white hover:bg-gray-50 shrink-0 disabled:opacity-40"
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
              Active pool: <span className="text-gray-900">{selectedPool}</span>
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
