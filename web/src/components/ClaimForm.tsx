import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useSignMessage,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { formatUnits, getAddress, hexToBytes, isAddress } from "viem";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CONFIG } from "@/config";
import { poolConfig } from "@/lib/contracts";
import { TeeClient } from "@/lib/teeClient";
import { claimChallenge } from "@/lib/challenge";
import { newEphemeralKey, decryptWith } from "@/lib/ecies";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

function mapTeeError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("not eligible") || lower.includes("no allocation"))
    return "This wallet has no allocation in this pool.";
  if (lower.includes("bad challenge") || lower.includes("signature") || lower.includes("sig"))
    return "Signature check failed.";
  return msg;
}

interface Voucher {
  amount: string;   // decimal string from TEE
  nonce: string;    // decimal string from TEE
  signature: `0x${string}`;
}

export default function ClaimForm() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [pool, setPool] = useState("");
  const [poolError, setPoolError] = useState("");

  const [freshToggle, setFreshToggle] = useState(false);
  const [claimAddress, setClaimAddress] = useState("");
  const [claimAddressError, setClaimAddressError] = useState("");

  // ephemeral private key stored in a ref — never rendered
  const ephPrivRef = useRef<string | null>(null);

  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [decimals, setDecimals] = useState<number>(18);
  const [ticker, setTicker] = useState<string>("tokens");
  const [asset, setAsset] = useState<`0x${string}` | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const wrongChain = isConnected && chainId !== CONFIG.chainId;

  // Resolve decimals whenever pool changes and is valid
  useEffect(() => {
    if (!publicClient || !isAddress(pool)) return;
    let cancelled = false;
    async function resolve() {
      if (!publicClient) return;
      try {
        const a = (await publicClient.readContract({
          ...poolConfig(pool as `0x${string}`),
          functionName: "asset",
        })) as `0x${string}`;
        if (cancelled) return;
        setAsset(a);
        if (a === ZERO_ADDR) {
          setDecimals(18);
          setTicker("C2FLR");
          return;
        }
        try {
          const d = (await publicClient.readContract({
            address: a,
            abi: [{ name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" }],
            functionName: "decimals",
          })) as number;
          if (!cancelled) { setDecimals(d); setTicker("tokens"); }
        } catch {
          // ponytail: fallback 18 on any ERC20 decimals failure
          if (!cancelled) { setDecimals(18); setTicker("tokens"); }
        }
      } catch {
        // pool not yet deployed or invalid; ignore
      }
    }
    resolve();
    return () => { cancelled = true; };
  }, [publicClient, pool]);

  function validateInputs(): boolean {
    let ok = true;
    if (!isAddress(pool)) {
      setPoolError("Enter a valid pool address (0x…)");
      ok = false;
    } else {
      setPoolError("");
    }
    if (freshToggle) {
      if (!isAddress(claimAddress)) {
        setClaimAddressError("Enter a valid fresh address (0x…)");
        ok = false;
      } else {
        setClaimAddressError("");
      }
    } else {
      setClaimAddressError("");
    }
    return ok;
  }

  async function handleGetPrize() {
    if (!validateInputs()) return;
    if (!isConnected) { toast.error("Connect your wallet first."); return; }
    if (wrongChain) { toast.error("Switch to Coston2 first."); return; }

    setVerifying(true);
    setVoucher(null);
    setTxHash(null);
    ephPrivRef.current = null;

    try {
      const eph = newEphemeralKey();
      ephPrivRef.current = eph.privHex; // stored only in ref, never rendered

      const claimAddr = freshToggle ? claimAddress : "";
      const msg = claimChallenge(getAddress(pool as `0x${string}`), eph.pubHex, claimAddr);

      const sig = await signMessageAsync({ message: msg });

      const { voucher: voucherHex } = await TeeClient.claimVerify({
        pool,
        recipientPubHex: eph.pubHex,
        challengeSig: sig,
        claimAddress: claimAddr,
      });

      let decrypted: Uint8Array;
      try {
        decrypted = decryptWith(eph.privHex, hexToBytes(voucherHex as `0x${string}`));
      } catch {
        toast.error("Couldn't decrypt your voucher — wrong key or corrupted response.");
        return;
      }

      const parsed: Voucher = JSON.parse(new TextDecoder().decode(decrypted));
      setVoucher(parsed);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      toast.error(mapTeeError(raw));
    } finally {
      setVerifying(false);
    }
  }

  async function handleClaimOnChain() {
    if (!voucher) return;
    if (!isAddress(pool)) return;

    setClaiming(true);
    try {
      const hash = await writeContractAsync({
        ...poolConfig(pool as `0x${string}`),
        functionName: "claim",
        args: [BigInt(voucher.amount), BigInt(voucher.nonce), voucher.signature],
      });
      setTxHash(hash);
      toast.success("Claimed on-chain!");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.length > 120 ? msg.slice(0, 120) + "…" : msg);
    } finally {
      setClaiming(false);
    }
  }

  // Wallet not connected
  if (!isConnected) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">
            Connect your wallet (top right) to claim your prize.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Network warning */}
      {wrongChain && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm text-yellow-800">Wrong network — switch to Coston2 to proceed.</span>
          <Button
            size="sm"
            variant="outline"
            className="border-yellow-400 text-yellow-700 hover:bg-yellow-100 shrink-0"
            onClick={() => switchChain({ chainId: CONFIG.chainId })}
          >
            Switch
          </Button>
        </div>
      )}

      {/* Pool address input */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-gray-700">Pool address</label>
        <Input
          placeholder="0x…"
          value={pool}
          onChange={(e) => { setPool(e.target.value); setPoolError(""); setVoucher(null); setTxHash(null); }}
          className="font-mono text-sm"
        />
        {poolError && <p className="text-xs text-red-600">{poolError}</p>}
      </div>

      {/* Fresh address toggle */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-700">
          <input
            type="checkbox"
            className="rounded"
            checked={freshToggle}
            onChange={(e) => {
              setFreshToggle(e.target.checked);
              setClaimAddress("");
              setClaimAddressError("");
            }}
          />
          Claim to a fresh address <span className="text-muted-foreground">(unlinkable)</span>
        </label>

        {freshToggle && (
          <div className="space-y-1 pl-5">
            <Input
              placeholder="0x… fresh wallet address"
              value={claimAddress}
              onChange={(e) => { setClaimAddress(e.target.value); setClaimAddressError(""); }}
              className="font-mono text-sm"
            />
            {claimAddressError && <p className="text-xs text-red-600">{claimAddressError}</p>}
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              The TEE will route your prize to this address. To achieve full unlinkability,
              switch to that fresh wallet account before clicking "Claim on-chain" below —
              otherwise the transaction will be sent from your connected wallet{" "}
              <span className="font-mono">{address?.slice(0, 8)}…</span> which is linkable.
            </p>
          </div>
        )}
      </div>

      {/* Primary action */}
      <Button
        onClick={handleGetPrize}
        disabled={verifying || wrongChain}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white"
      >
        {verifying ? "Verifying with TEE…" : "Get my prize"}
      </Button>

      {/* Voucher result */}
      {voucher && (
        <div className="rounded-md border bg-green-50 border-green-200 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Badge className="bg-green-100 text-green-800 border-green-200">Eligible</Badge>
            <span className="text-sm text-gray-700">Your allocation:</span>
            <span className="tabular-nums font-mono font-semibold text-blue-700">
              {formatUnits(BigInt(voucher.amount), decimals)} {ticker}
            </span>
          </div>

          {/* Fresh-address unlinkability reminder at claim time */}
          {freshToggle && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              Remember: switch your wallet to{" "}
              <span className="font-mono">{claimAddress.slice(0, 8)}…</span> before
              submitting the on-chain transaction for unlinkability.
            </p>
          )}

          <Button
            onClick={handleClaimOnChain}
            disabled={claiming}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            {claiming ? "Submitting…" : "Claim on-chain"}
          </Button>

          {txHash && (
            <p className="text-xs text-green-700">
              Transaction submitted:{" "}
              <a
                href={`${CONFIG.explorer}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-blue-600 hover:underline break-all"
              >
                {txHash}
              </a>
            </p>
          )}
        </div>
      )}

      {/* Asset badge (informational, shown once pool is resolved) */}
      {asset !== null && isAddress(pool) && (
        <p className="text-xs text-muted-foreground">
          Pool asset:{" "}
          {asset === ZERO_ADDR ? (
            <span className="font-mono">Native (C2FLR)</span>
          ) : (
            <a
              href={`${CONFIG.explorer}/address/${asset}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-blue-600 hover:underline"
            >
              {asset}
            </a>
          )}
        </p>
      )}
    </div>
  );
}
