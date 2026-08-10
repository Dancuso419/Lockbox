import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { isAddress } from "viem";
import { Input } from "@/components/ui/input";
import PublicPoolCard from "@/components/PublicPoolCard";
import Eyebrow from "@/components/Eyebrow";

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
    <div className="shell shell-narrow space-y-8 py-16">
      <div>
        <Eyebrow>Public</Eyebrow>
        <h1 className="font-display mt-5 text-[clamp(2rem,4vw,2.75rem)]">Explore a pool</h1>
        <p className="mt-5 max-w-lg text-sm leading-relaxed text-muted-foreground">
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
