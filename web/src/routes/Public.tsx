import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { isAddress } from "viem";
import { Input } from "@/components/ui/input";
import PublicPoolCard from "@/components/PublicPoolCard";
import PageHeader from "@/components/PageHeader";
import { EmptyState } from "@/components/States";
import BoxWall from "@/components/BoxWall";

export default function Public() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [inputVal, setInputVal] = useState(searchParams.get("pool") ?? "");

  const poolAddr = inputVal.trim();
  const valid = isAddress(poolAddr);

  function handleChange(v: string) {
    setInputVal(v);
    if (isAddress(v.trim())) {
      setSearchParams({ pool: v.trim() }, { replace: true });
    }
  }

  return (
    <div className="shell space-y-12 py-16">
      <PageHeader
        eyebrow="Public"
        title="Explore a pool"
        lede="Anyone can verify the totals and the compliance attestation. Individual allocations stay hidden — that's the whole point."
        aside={
          <div>
            <label
              htmlFor="pool-address"
              className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              Pool address
            </label>
            <Input
              id="pool-address"
              placeholder="0x…"
              value={inputVal}
              onChange={(e) => handleChange(e.target.value)}
              className="h-11 font-mono"
            />
            {poolAddr.length > 0 && !valid && (
              <p className="mt-2 text-xs text-destructive">Enter a valid Ethereum address</p>
            )}
          </div>
        }
      />

      {valid ? (
        <PublicPoolCard address={poolAddr as `0x${string}`} />
      ) : (
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <EmptyState
            title="Paste a pool address to inspect it"
            detail="You'll see what the chain sees: the deposit, what has been claimed, and whether the organizer's split has been attested. Never who got what."
          />
          <div className="hidden lg:block">
            <BoxWall className="w-full" openIndex={null} />
          </div>
        </div>
      )}
    </div>
  );
}
