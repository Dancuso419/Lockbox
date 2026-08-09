import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { isAddress } from "viem";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
      <Card className="bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Public Pool Lookup</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="0x… pool address"
            value={inputVal}
            onChange={(e) => handleChange(e.target.value)}
            className="font-mono"
          />
          {poolAddr.length > 0 && !valid && (
            <p className="mt-1.5 text-xs text-red-500">Enter a valid Ethereum address</p>
          )}
        </CardContent>
      </Card>

      {valid && <PublicPoolCard address={poolAddr as `0x${string}`} />}
    </div>
  );
}
