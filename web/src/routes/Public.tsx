import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { isAddress } from "viem";
import { Input } from "@/components/ui/input";
import PublicPoolCard from "@/components/PublicPoolCard";

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
    <div className="mx-auto max-w-3xl px-6 py-14 space-y-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-glow">Public</p>
        <h1 className="mt-2 text-3xl font-medium tracking-tight">Explore a pool</h1>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
          Anyone can verify the totals and the compliance attestation. Individual allocations stay
          hidden — that's the whole point.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">Pool address</label>
        <Input
          placeholder="0x… pool address"
          value={inputVal}
          onChange={(e) => handleChange(e.target.value)}
          className="font-mono"
        />
        {poolAddr.length > 0 && !valid && (
          <p className="mt-1.5 text-xs text-destructive">Enter a valid Ethereum address</p>
        )}
      </div>

      {valid && <PublicPoolCard address={poolAddr as `0x${string}`} />}
    </div>
  );
}
