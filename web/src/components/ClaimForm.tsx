import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
  usePublicClient,
  useSignMessage,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { formatUnits, getAddress, hexToBytes, isAddress } from "viem";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CONFIG } from "@/config";
import { poolConfig } from "@/lib/contracts";
import { TeeClient } from "@/lib/teeClient";
import { claimChallenge } from "@/lib/challenge";
import { newEphemeralKey, decryptWith } from "@/lib/ecies";
import { EmptyState } from "./States";

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
  const { connect } = useConnect();
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
      <EmptyState
        title="Connect a wallet to claim"
        detail="Your wallet signature is what proves to the enclave that an allocation is yours. Nothing is revealed until you sign."
        action={
          <button
            onClick={() => connect({ connector: injected() })}
            className="rounded-lg bg-primary px-6 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-primary-foreground transition-transform hover:-translate-y-0.5"
          >
            Connect wallet
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Network warning */}
      {wrongChain && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
          <span className="text-sm text-warning">Wrong network — switch to Coston2 to proceed.</span>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-warning/40 text-warning hover:bg-warning/15"
            onClick={() => switchChain({ chainId: CONFIG.chainId })}
          >
            Switch
          </Button>
        </div>
      )}

      {/* Pool address input */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Pool address</label>
        <Input
          placeholder="0x…"
          value={pool}
          onChange={(e) => { setPool(e.target.value); setPoolError(""); setVoucher(null); setTxHash(null); }}
          className="font-mono text-sm"
        />
        {poolError && <p className="text-xs text-destructive">{poolError}</p>}
      </div>

      {/* Fresh address toggle */}
      <div className="space-y-2">
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-foreground">
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
            {claimAddressError && <p className="text-xs text-destructive">{claimAddressError}</p>}
            <p className="rounded border border-warning/25 bg-warning/10 px-2 py-1 text-xs text-warning">
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
        className="w-full"
      >
        {verifying ? "Verifying with TEE…" : "Get my prize"}
      </Button>

      {/* Voucher result */}
      {voucher && (
        <div className="space-y-3 rounded-lg border border-success/25 bg-success/10 p-4">
          <div className="flex items-center gap-2">
            <Badge className="border-success/30 bg-success/15 text-success">Eligible</Badge>
            <span className="text-sm text-muted-foreground">Your allocation:</span>
            <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
              {formatUnits(BigInt(voucher.amount), decimals)} {ticker}
            </span>
          </div>

          {/* Fresh-address unlinkability reminder at claim time */}
          {freshToggle && (
            <p className="rounded border border-warning/25 bg-warning/10 px-2 py-1 text-xs text-warning">
              Remember: switch your wallet to{" "}
              <span className="font-mono">{claimAddress.slice(0, 8)}…</span> before
              submitting the on-chain transaction for unlinkability.
            </p>
          )}

          <Button
            onClick={handleClaimOnChain}
            disabled={claiming}
            className="w-full"
          >
            {claiming ? "Submitting…" : "Claim on-chain"}
          </Button>

          {txHash && (
            <p className="text-xs text-success">
              Transaction submitted:{" "}
              <a
                href={`${CONFIG.explorer}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-mono text-glow hover:underline"
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
              className="font-mono text-glow hover:underline"
            >
              {asset}
            </a>
          )}
        </p>
      )}
    </div>
  );
}
